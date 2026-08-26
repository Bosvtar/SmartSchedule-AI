# SmartSchedule AI — Vercel + PWA

Ứng dụng React/Vite + PWA với API server-side gọi Google Gemini.

## Deploy Vercel

1. Push toàn bộ thư mục này lên GitHub.
2. Vào Vercel → Add New → Project → Import repository.
3. Framework: **Vite**.
4. Build Command: `npm run build`.
5. Output Directory: `dist`.
6. Vào **Settings → Environment Variables** và thêm `GEMINI_API_KEY` bằng API key Gemini của bạn.
7. Chọn Production (và Preview/Development nếu cần), sau đó Deploy/Redeploy.

Không đặt Gemini API key trong `VITE_*` và không commit `.env` chứa key thật.

## Chạy local

```bash
npm install
cp .env.example .env
# điền GEMINI_API_KEY vào .env
npm run dev
```

Mở `http://localhost:5173`.

## Production build

```bash
npm run build
npm run preview
```

## Cấu trúc Vercel

- `api/extract-schedule.ts`: Vercel Function xử lý ảnh và gọi Gemini.
- `api/health.ts`: health check tại `/api/health`.
- `public/sw.js`: Service Worker cho PWA.
- `public/manifest.webmanifest`: PWA manifest.
- `vercel.json`: build, SPA rewrite và Function config.

## Lưu ý

- Camera trên web cần HTTPS (Vercel đã cung cấp HTTPS).
- AI extraction cần Internet và `GEMINI_API_KEY`.
- PWA/offline cache không làm Gemini hoạt động offline.
- Thông báo nền đáng tin cậy cần Web Push nếu muốn gửi từ server khi trình duyệt không mở.


## Vercel: lỗi 404 tại `/api/extract-schedule`

Nếu frontend mở bình thường nhưng Console báo `POST /api/extract-schedule 404`, hãy kiểm tra Deployment > Functions. Bản này không khai báo `functions` pattern thủ công trong `vercel.json`; Vercel tự động nhận các file Node.js/TypeScript trong thư mục `/api` thành Functions. Điều này tránh lỗi khớp pattern trên một số phiên bản build hiện tại. Sau khi cập nhật code, hãy **Redeploy** để Vercel tạo lại Functions.

Kiểm tra nhanh:

- Mở `https://TEN-DOMAIN.vercel.app/api/health` — phải trả JSON `{ "ok": true, "service": "smartschedule-api" }`.
- Nếu `/api/health` vẫn 404, hãy kiểm tra Vercel Project Settings > General > Root Directory phải là thư mục chứa `package.json`, `index.html` và `api/`.
- `GEMINI_API_KEY` chỉ cần thiết sau khi `/api/health` đã hoạt động.
