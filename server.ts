import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Support JSON payload up to 20MB for image base64
  app.use(express.json({ limit: "20mb" }));

  // Health check endpoint
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Server-side Gemini schedule extraction endpoint
  app.post("/api/extract-schedule", async (req, res) => {
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
        Hãy phân tích hình ảnh này để trích xuất danh sách thời khóa biểu / lịch học / lịch dạy / lịch thi.

        QUY TẮC CỐT LÕI - PHÂN TÍCH THEO CỘT CỦA BẢNG BIỂU (BẮT BUỘC TUÂN THỦ NGUYÊN TẮC VÀ ĐỐI CHIẾU CHÍNH XÁC THEO TỪNG CỘT):
        Bảng biểu / tiến trình giảng dạy / thời khóa biểu trong ảnh có cấu trúc các cột như sau, hãy đối chiếu chính xác theo từng cột để phân tích và trích xuất đúng:
        
        1. CỘT THỨ NHẤT (Cột 1): TÊN LỚP (className)
           - Lấy chính xác giá trị ở cột 1 làm tên lớp / mã lớp (ví dụ: "10A1", "12D3", "KMP18", "KMP18, KNP27, KPT31", v.v.).
           - Nếu các dòng tiếp theo ở cột 1 bị gộp ô (merged cells) hoặc để trống, hãy kế thừa tên lớp từ dòng liền trước hoặc từ thông tin "LỚP:" ở phần tiêu đề đầu trang.

        2. CỘT THỨ HAI (Cột 2): TÊN MÔN HỌC (subject)
           - Lấy tên môn học ở cột 2 này (ví dụ: "Lý thuyết điều khiển tự động", "Toán", "Vật lý", "Tiếng Anh", v.v.).
           - Nếu các dòng tiếp theo ở cột 2 bị gộp ô hoặc để trống, lấy tên môn học từ dòng trước hoặc ở tiêu đề "MÔN:", "MÔN HỌC:", "HỌC PHẦN:".

        3. CỘT THỨ TƯ (Cột 4): TÊN BÀI HỌC (lessonName)
           - Lấy chính xác tên bài học / nội dung bài giảng ở cột 4 này (ví dụ: "Khái niệm mở đầu về ĐKTĐ", "Mô tả toán học hệ thống liên tục", "Hàm truyền đạt", v.v.).
           - Nếu có số bài ở cột 4 hoặc cột trước (ví dụ "Bài 1", "Bài 2" hoặc "1", "2"), định dạng chuẩn: "Bài <số>: <Tên bài>" (hoặc giữ nguyên tên bài nếu không có số).
           - QUY TẮC BẮT BUỘC: Mỗi hàng có tên bài học riêng ở Cột 4. TUYỆT ĐỐI KHÔNG sao chép hoặc lặp lại cùng một tên bài học cho tất cả các hàng!

        4. CỘT THỨ NĂM (Cột 5): TIẾT HỌC (period)
           - Lấy chính xác giá trị tiết học ở cột 5 (ví dụ: "1-1", "1-2", "1-3", "3-4", "4-4", "5-5", "6-6", "6-7", "6-8", "7-8", "8-8", "4", "5", v.v.).
           - Dựa vào giá trị tiết học ở Cột 5, tự động tính ra startTime và endTime theo BẢNG QUY ĐỔI TIẾT HỌC CHÍNH XÁC dưới đây.

        5. CỘT THỨ SÁU (Cột 6): THỨ TRONG TUẦN (dayOfWeek)
           - Lấy thứ trong tuần ở cột 6: "Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ Nhật".
           - Bắt buộc phải đồng bộ và khớp chính xác với ngày học ở Cột 7.

        6. CỘT THỨ BẢY (Cột 7): NGÀY HỌC (date)
           - Lấy ngày học ở cột 7, định dạng đầu ra: "DD/MM/YYYY" (ví dụ: "04/08/2026", "11/08/2026", "12/08/2026", "18/08/2026").
           - NĂM HỌC HIỆN TẠI LÀ 2026 (hoặc năm học 2026-2027). Nếu cột 7 chỉ ghi ngày/tháng (ví dụ "04/08", "11/08"), PHẢI tự động gán năm 2026 thành "04/08/2026", "11/08/2026". TUYỆT ĐỐI KHÔNG gán năm cũ như 2024 hay 2025.
           - Nếu là lịch tuần cố định không có ngày tháng cụ thể, để date rỗng "".

        7. CỘT THỨ CHÍN (Cột 9): VỊ TRÍ PHÒNG HỌC / ĐỊA ĐIỂM (location)
           - Lấy vị trí phòng học ở cột 9 (ví dụ: "210/H10", "203/H10", "302/D3", "105/A1", "P.201", "GD3", "Online", v.v.).
           - TUYỆT ĐỐI KHÔNG nhầm phòng học ở cột 9 thành tên lớp. Nếu không có phòng, để "Chưa cập nhật".

        - Chú ý: Cột thứ 3 (thường là STT hoặc mã) và Cột thứ 8 (thường là giảng viên hoặc ghi chú) bỏ qua, không gán nhầm vào các trường trên.

        BẢNG QUY ĐỔI TIẾT HỌC CHÍNH XÁC (DÙNG CHO CỘT 5 ĐỂ TÍNH startTime VÀ endTime):
        + Tiết 1: 07:00 đến 07:45 (07:00 - 07:45)
        + Tiết 2: 07:50 đến 08:35 (07:50 - 08:35)
        + Tiết 3: 08:45 đến 09:30 (08:45 - 09:30) [Bắt đầu 08:45, kết thúc 09:30]
        + Tiết 4: 09:35 đến 10:20 (09:35 - 10:20) [Bắt đầu 09:35, kết thúc 10:20]
        + Tiết 5: 10:30 đến 11:15 (10:30 - 11:15) [Bắt đầu 10:30, kết thúc 11:15]
        + Tiết 6: 14:00 đến 14:45 (14:00 - 14:45)
        + Tiết 7: 14:50 đến 15:35 (14:50 - 15:35)
        + Tiết 8: 15:45 đến 16:30 (15:45 - 16:30)

        Quy tắc ghép tiết (startTime là giờ bắt đầu của tiết đầu, endTime là giờ kết thúc của tiết cuối):
        + Tiết 1-1: 07:00 - 07:45
        + Tiết 1-2: 07:00 - 08:35
        + Tiết 1-3: 07:00 - 09:30
        + Tiết 1-4: 07:00 - 10:20
        + Tiết 1-5: 07:00 - 11:15
        + Tiết 2-2: 07:50 - 08:35
        + Tiết 2-3: 07:50 - 09:30
        + Tiết 2-4: 07:50 - 10:20
        + Tiết 3-3: 08:45 - 09:30
        + Tiết 3-4: 08:45 - 10:20
        + Tiết 3-5: 08:45 - 11:15
        + Tiết 4-4: 09:35 - 10:20
        + Tiết 4-5: 09:35 - 11:15
        + Tiết 5-5: 10:30 - 11:15
        + Tiết 6-6: 14:00 - 14:45
        + Tiết 6-7: 14:00 - 15:35
        + Tiết 6-8: 14:00 - 16:30
        + Tiết 7-7: 14:50 - 15:35
        + Tiết 7-8: 14:50 - 16:30
        + Tiết 8-8: 15:45 - 16:30

        CHỐNG TRÙNG LẶP:
        - Mỗi buổi học / ngày học và tiết học chỉ được xuất hiện DUY NHẤT 1 lần trong mảng kết quả JSON.

        Trả về danh sách các buổi học dưới dạng mảng JSON.
      `;

      const candidateModels = [
        "gemini-2.5-flash",
        "gemini-3.7-flash",
        "gemini-2.5-pro",
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

      return res.json({ success: true, data: parsed });
    } catch (error: any) {
      console.error("Server Gemini extraction error:", error);
      const message = error?.message || "Lỗi khi xử lý hình ảnh với Gemini AI";
      return res.status(500).json({ error: message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*all", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error("Failed to start server:", err);
});
