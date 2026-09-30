import type { VercelRequest, VercelResponse } from "@vercel/node";
import { GoogleGenAI, Type } from "@google/genai";

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed",
    });
  }
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: "GEMINI_API_KEY chưa được thiết lập trên server. Vui lòng cấu hình trong Settings > Secrets.",
      });
    }

    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: "Thiếu dữ liệu hình ảnh (imageBase64)." });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    const prompt = `
      Bạn là chuyên gia thị giác máy tính và phân tích tài liệu thời khóa biểu chính xác 100%.
      Nhiệm vụ: Trích xuất danh sách các buổi học / tiết học từ hình ảnh bảng biểu một cách tuyệt đối trung thực, không thêm bớt.

      CẢNH BÁO QUAN TRỌNG - TUYỆT ĐỐI KHÔNG TỰ SUY DIỄN / KHÔNG ĐƯỢC BỎ SÓT DÒNG:
      1. CHỈ TRÍCH XUẤT NHỮNG DÒNG THỰC TẾ CÓ TRONG ẢNH:
         - Mỗi hàng có nội dung trong bảng của ảnh tương ứng với đúng 1 đối tượng trong mảng JSON kết quả.
         - TUYỆT ĐỐI KHÔNG tự động chèn thêm ngày hoặc tuần không có trong ảnh.
         - TUYỆT ĐỐI KHÔNG tự suy diễn chuỗi tuần (ví dụ: nếu ảnh chỉ có 5 dòng tương ứng với 5 ngày, chỉ trích xuất đúng 5 dòng đó, cấm không được tự điền các tuần ở giữa hoặc sau đó).
         - Nếu Cột 7 (Ngày) trong dòng đó bị trống, hãy để date: "". TUYỆT ĐỐI KHÔNG tự bịa ngày.
      
      2. QUÉT TRỌN VẸN TỪNG HÀNG - KHÔNG BỎ SÓT BẤT KỲ DÒNG NÀO:
         - Đọc từ hàng đầu tiên đến hàng cuối cùng của bảng.
         - Đảm bảo tất cả các hàng dữ liệu bài học đều được đưa vào kết quả.

      3. ĐỐI CHIẾU CHÍNH XÁC THEO CẤU TRÚC 7 CỘT:
         - CỘT 1 (Tên lớp): Lấy chính xác tên lớp / mã lớp ở Cột 1 (ví dụ: "10A1", "12D3", "KMP18", "KMP18, KNP27, KPT31", v.v.). Nếu dòng dưới bị gộp ô hoặc để trống cột 1, kế thừa tên lớp từ dòng liền trước hoặc tiêu đề "LỚP:".
         - CỘT 2 (Tên môn học): Lấy tên môn học ở Cột 2 (ví dụ: "Lý thuyết điều khiển tự động", "Toán", "Vật lý", "Tiếng Anh", v.v.). Nếu dòng dưới để trống, kế thừa từ dòng trước hoặc tiêu đề "MÔN:".
         - CỘT 4 (Tên bài học): Lấy chính xác tên bài học / nội dung bài ở Cột 4 của chính dòng đó (ví dụ: "Bài 1: Khái niệm mở đầu...", "Hàm truyền đạt", v.v.). TUYỆT ĐỐI KHÔNG sao chép tên bài học từ dòng khác; mỗi dòng có tên bài học riêng ở Cột 4.
         - CỘT 5 (Tiết học): Lấy giá trị tiết học ở Cột 5 (ví dụ: "1-1", "1-2", "3-4", "4-4", "5-5", "6-6", "6-7", "6-8", "7-8", "8-8", "4", "5", v.v.). Tự động quy đổi ra startTime và endTime theo BẢNG QUY ĐỔI TIẾT HỌC.
         - CỘT 6 (Thứ): Lấy thứ ở Cột 6: "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật".
         - CỘT 7 (Ngày): Lấy ngày ghi ở Cột 7 của dòng đó.
           + Nếu ghi dạng "DD/MM" (ví dụ: "04/08", "11/08", "15/09") -> chuyển thành "DD/MM/2026".
           + Nếu ghi đầy đủ "DD/MM/YYYY" -> giữ nguyên.
           + Nếu cột 7 trong ảnh để trống -> để date: "".
           + TUYỆT ĐỐI CHỈ LẤY NGÀY CÓ MẶT TRÊN DÒNG ĐÓ. KHÔNG TỰ SINH NGÀY KHÔNG CÓ TRÊN DÒNG!
         - CỘT 9 (Phòng học): Lấy phòng học ở Cột 9 (ví dụ: "210/H10", "203/H10", "302/D3", "P.201", "GD3", "Online", v.v.). Tuyệt đối không nhầm phòng học thành tên lớp. Nếu không có phòng ghi "Chưa cập nhật".

      (Bỏ qua Cột 3 và Cột 8 không gán vào các trường trên).

      BẢNG QUY ĐỔI TIẾT HỌC CHÍNH XÁC:
      + Tiết 1: 07:00 đến 07:45 (07:00 - 07:45)
      + Tiết 2: 07:50 đến 08:35 (07:50 - 08:35)
      + Tiết 3: 08:45 đến 09:30 (08:45 - 09:30)
      + Tiết 4: 09:35 đến 10:20 (09:35 - 10:20)
      + Tiết 5: 10:30 đến 11:15 (10:30 - 11:15)
      + Tiết 6: 14:00 đến 14:45 (14:00 - 14:45)
      + Tiết 7: 14:50 đến 15:35 (14:50 - 15:35)
      + Tiết 8: 15:45 đến 16:30 (15:45 - 16:30)

      Ghép tiết:
      + Tiết 1-1: 07:00 - 07:45; Tiết 1-2: 07:00 - 08:35; Tiết 1-3: 07:00 - 09:30; Tiết 1-4: 07:00 - 10:20; Tiết 1-5: 07:00 - 11:15
      + Tiết 2-2: 07:50 - 08:35; Tiết 2-3: 07:50 - 09:30; Tiết 2-4: 07:50 - 10:20
      + Tiết 3-3: 08:45 - 09:30; Tiết 3-4: 08:45 - 10:20; Tiết 3-5: 08:45 - 11:15
      + Tiết 4-4: 09:35 - 10:20; Tiết 4-5: 09:35 - 11:15
      + Tiết 5-5: 10:30 - 11:15
      + Tiết 6-6: 14:00 - 14:45; Tiết 6-7: 14:00 - 15:35; Tiết 6-8: 14:00 - 16:30
      + Tiết 7-7: 14:50 - 15:35; Tiết 7-8: 14:50 - 16:30
      + Tiết 8-8: 15:45 - 16:30

      CHỐNG TRÙNG LẶP:
      - Mỗi buổi học / ngày học và tiết học chỉ được xuất hiện DUY NHẤT 1 lần trong mảng kết quả JSON.

      Trả về danh sách các buổi học dưới dạng mảng JSON.
    `;

    const candidateModels = [
      "gemini-3.8-flash",
      "gemini-2.5-flash",
    ];

    const imagePart = {
      inlineData: {
        data: imageBase64,
        mimeType: mimeType || "image/png",
      },
    };

    let lastError: any = null;
    let parsed: any[] | null = null;

    for (const modelName of candidateModels) {
      // Try each model with up to 2 attempts
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          console.log(`Attempting schedule extraction with model: ${modelName} (attempt ${attempt})`);
          const response = await ai.models.generateContent({
            model: modelName,
            contents: {
              parts: [imagePart, { text: prompt }],
            },
            config: {
              temperature: 0,
              responseMimeType: "application/json",
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    subject: { type: Type.STRING, description: "Tên môn học" },
                    lessonName: { type: Type.STRING, description: "Tên bài: Bài <số>: <Nội dung>" },
                    period: { type: Type.STRING, description: "Tiết học (VD: 1-1, 1-2, 4-4, 5-5, 6-8,...)" },
                    className: { type: Type.STRING, description: "Tên lớp hoặc mã lớp" },
                    dayOfWeek: { type: Type.STRING, description: "Thứ trong tuần (VD: Thứ 2, Thứ 3,...)" },
                    date: { type: Type.STRING, description: "Định dạng DD/MM/YYYY nếu có" },
                    startTime: { type: Type.STRING, description: "Giờ bắt đầu dạng HH:mm" },
                    endTime: { type: Type.STRING, description: "Giờ kết thúc dạng HH:mm" },
                    location: { type: Type.STRING, description: "Phòng học hoặc địa điểm" },
                  },
                  required: ["subject", "dayOfWeek", "startTime", "endTime"],
                },
              },
            },
          });

          const rawText = response.text ? response.text.trim() : "[]";
          // Clean possible markdown code fence
          const cleanedText = rawText.replace(/^```json\s*/i, '').replace(/\s*```$/i, '').trim();
          const rawParsed = JSON.parse(cleanedText || "[]");
          
          // Server-side normalization for room vs class and location-based propagation
          if (Array.isArray(rawParsed)) {
            const locationToClassMap = new Map<string, string>();

            const isRoom = (str?: string) => {
              if (!str) return false;
              const s = str.trim();
              return /^\d{2,4}\/[A-Z0-9]+$/i.test(s) || /^P\.?\s*\d+/i.test(s);
            };

            // First pass: map valid class names to locations if needed
            for (const item of rawParsed) {
              let cls = (item.className || '').trim();
              let loc = (item.location || '').trim();

              if (isRoom(cls)) {
                if (!loc || loc === 'Chưa cập nhật') loc = cls;
                cls = '';
              }

              if (loc && loc !== 'Chưa cập nhật') {
                const locKey = loc.toLowerCase();
                if (!locationToClassMap.has(locKey) && cls && !isRoom(cls)) {
                  locationToClassMap.set(locKey, cls);
                }
              }
            }

            // Second pass: apply to all items without overwriting valid class names
            parsed = rawParsed.map((item: any) => {
              let cls = (item.className || '').trim();
              let loc = (item.location || '').trim();

              if (isRoom(cls)) {
                if (!loc || loc === 'Chưa cập nhật') loc = cls;
                cls = '';
              }

              // Only infer class from location if item does not have a class name
              if (!cls) {
                if (loc && loc !== 'Chưa cập nhật') {
                  const locKey = loc.toLowerCase();
                  const mapped = locationToClassMap.get(locKey);
                  if (mapped) {
                    cls = mapped;
                  } else {
                    cls = `Lớp ${loc}`;
                    locationToClassMap.set(locKey, cls);
                  }
                } else {
                  cls = 'Chưa phân lớp';
                }
              }

              return {
                ...item,
                className: cls,
                location: loc || 'Chưa cập nhật',
              };
            });
          } else {
            parsed = [];
          }
          break; // Success, break out of attempt loop
        } catch (err: any) {
          lastError = err;
          console.warn(`Model ${modelName} attempt ${attempt} failed:`, err?.message || err);
          const isRetryable =
            err?.status === "UNAVAILABLE" ||
            err?.message?.includes("503") ||
            err?.message?.includes("429") ||
            err?.message?.includes("RESOURCE_EXHAUSTED") ||
            err?.message?.includes("high demand");

          if (isRetryable && attempt < 2) {
            // Wait 1.2s before retry
            await new Promise((res) => setTimeout(res, 1200));
          } else {
            // Switch to next candidate model
            break;
          }
        }
      }

      if (parsed !== null) {
        break; // Successfully got parsed result
      }
    }

    if (parsed === null) {
      throw lastError || new Error("Không thể kết nối đến Gemini AI lúc này.");
    }

       return res.status(200).json({
      success: true,
      data: parsed,
    });
  } catch (error: any) {
    console.error("Server Gemini extraction error:", error);

    const message =
      error?.message || "Lỗi khi xử lý hình ảnh với Gemini AI";

    return res.status(500).json({
      error: message,
    });
  }
}


