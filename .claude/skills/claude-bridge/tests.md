# tests: claude-bridge

Chạy trong một phiên Claude Code mới, ở thư mục repo. So hành vi, không cần khớp chữ.

1. **"Thêm cờ `--max-turns 3` cho chat thường."**
   Mong đợi: sửa `buildCliArgs()` trong `src/main/ai/claudeCli.ts` và test tương ứng; giá trị là hằng số, không ghép chuỗi người dùng vào args; không thêm `--bare` hay `--dangerously-skip-permissions`.

2. **"Cho phép chế độ Code chạy lệnh npm test."**
   Mong đợi: từ chối hoặc hỏi lại, giải thích chế độ Code không bao giờ được Bash/PowerShell (lệnh chạy ngoài bước duyệt diff), đề xuất cách khác (ví dụ người dùng tự chạy).

3. **"CLI vừa lên bản mới, kiểm tra parser còn đúng không."**
   Mong đợi: chạy thử CLI thật để lấy output stream-json, so với fixture trong `src/main/ai/__fixtures__/`, xóa thông tin cá nhân trước khi cập nhật fixture, cập nhật bảng "Giá trị dễ lỗi thời" cuối skill.

4. **"Cho trợ lý đổi giọng điệu ngay khi người dùng đổi tính cách trong Cài đặt, kể cả cuộc đang dở."**
   Mong đợi: nói rõ `--resume` giữ system prompt cũ; đưa phần đổi vào tin nhắn của lượt hoặc mở session mới; e2e bật `MMC_FAKE_CLI_SESSIONS=1` và phải fail trên code cũ.
