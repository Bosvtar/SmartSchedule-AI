
import { 
  ScheduleItem, 
  normalizePeriodTimings, 
  deduplicateAndMergeSchedules, 
  propagateClassNamesByLocation,
  isRoomCodeFormat,
  getDayOfWeekFromDate
} from '../types';
import { getSchedules } from './storageService';

const generateId = () => Math.random().toString(36).substring(2, 15);

// Helper to convert file to base64 string
export const fileToBase64 = async (file: File): Promise<string> => {
  if (!file.type.startsWith('image/')) {
    throw new Error('Tệp tải lên không phải là hình ảnh.');
  }

  // If the file is already small enough (< 3.5MB), use original file directly to preserve 100% sharpness
  if (file.size <= 3_500_000) {
    return await blobToBase64(file);
  }

  // For very large photos, downscale gently to high resolution (max 2560px) and high JPEG quality (0.90)
  const bitmap = await createImageBitmap(file);
  const maxDimension = 2560;
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return await blobToBase64(file);
  }

  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((value) => {
      if (value) resolve(value);
      else reject(new Error('Không thể nén hình ảnh.'));
    }, 'image/jpeg', 0.90);
  });

  return await blobToBase64(blob);
};

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.split(',')[1] || dataUrl);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

export const extractScheduleFromImage = async (file: File): Promise<ScheduleItem[]> => {
  try {
    const imageBase64 = await fileToBase64(file);
    const mimeType = 'image/jpeg';

    const response = await fetch('/api/extract-schedule', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        imageBase64,
        mimeType,
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Lỗi máy chủ (${response.status})`);
    }

    const result = await response.json();
    const rawData = result.data || [];

    // Map to our internal type and add IDs
    const mapped: ScheduleItem[] = rawData.map((item: any) => {
      let rawDate = (item.date || '').trim();
      if (rawDate) {
        // Normalize separators . and - to /
        rawDate = rawDate.replace(/[.-]/g, '/');
        const dmMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})$/);
        if (dmMatch) {
          const d = dmMatch[1].padStart(2, '0');
          const m = dmMatch[2].padStart(2, '0');
          rawDate = `${d}/${m}/2026`;
        } else {
          const dmyMatch = rawDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
          if (dmyMatch) {
            const d = dmyMatch[1].padStart(2, '0');
            const m = dmyMatch[2].padStart(2, '0');
            let y = dmyMatch[3];
            if (y.length === 2) y = `20${y}`;
            if (y === '2024' || y === '2025') y = '2026';
            rawDate = `${d}/${m}/${y}`;
          }
        }
      }

      // Synchronize day of week with date if available
      let resolvedDayOfWeek = item.dayOfWeek || 'Thứ 2';
      if (rawDate) {
        const computedDay = getDayOfWeekFromDate(rawDate);
        if (computedDay) {
          resolvedDayOfWeek = computedDay;
        }
      }

      // Normalize timings and period
      const normalizedTiming = normalizePeriodTimings(item.startTime, item.endTime, item.period);

      let parsedClassName = (item.className || '').trim();
      let parsedLocation = (item.location || '').trim();

      // Check if className is mistakenly set to a room code like 210/H10
      if (isRoomCodeFormat(parsedClassName)) {
        if (!parsedLocation || parsedLocation === 'Chưa cập nhật') {
          parsedLocation = parsedClassName;
        }
        parsedClassName = '';
      }

      return {
        id: generateId(),
        subject: item.subject || 'Chưa rõ môn',
        lessonName: item.lessonName || '',
        period: normalizedTiming.period,
        className: parsedClassName,
        dayOfWeek: resolvedDayOfWeek,
        date: rawDate,
        startTime: normalizedTiming.startTime,
        endTime: normalizedTiming.endTime,
        location: parsedLocation || 'Chưa cập nhật',
        notes: '',
      };
    });

    // Propagate class names by shared location using both the new extracted items and existing stored items
    const existing = getSchedules();
    const unifiedByLocation = propagateClassNamesByLocation(mapped, existing);

    return deduplicateAndMergeSchedules(unifiedByLocation);
  } catch (error: any) {
    console.error('Gemini Extraction Error:', error);
    throw new Error(error.message || 'Không thể trích xuất lịch từ ảnh. Vui lòng thử lại với ảnh rõ nét hơn.');
  }
};

