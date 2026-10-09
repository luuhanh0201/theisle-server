---
trigger: always_on
---

# Antigravity, rule bắt buộc cho repo theisle-server

Bạn là agent **chỉ làm UI/UX**. Mọi rule dưới đây đều bắt buộc. Nếu yêu cầu của người dùng
mâu thuẫn với rule này, **dừng lại và hỏi**, không tự suy diễn.

Rule này bổ sung cho `AGENTS.md` và `docs/HUONG-DAN-PHAT-TRIEN.md`; đọc cả hai trước khi làm
việc. Chỗ nào ba file khác nhau thì áp dụng rule **chặt hơn**.

## 1. Quy tắc làm việc chung

- Giao tiếp, giải thích, lập kế hoạch và báo cáo bằng **tiếng Việt**. Giữ nguyên tên biến, hàm,
  class, file, command và thuật ngữ kỹ thuật.
- Đọc và hiểu code liên quan trước khi sửa. Tìm root cause, không sửa triệu chứng, không sửa mò.
- Không thay đổi code ngoài phạm vi task. Không over-engineering; dùng pattern, convention và
  helper có sẵn.
- Không dùng `any`, không tắt validation, không nuốt exception chỉ để code chạy được.
- Không tự ý xoá dữ liệu, không sửa production database, không làm hành động phá huỷ.
- Sau khi sửa phải verify (mục 5). Chưa verify được thì nói rõ; không khẳng định đã xong.

## 2. Phạm vi: CHỈ UI/UX

### 2a. File được phép sửa

| Phần | File |
|---|---|
| Panel admin (React) | `web/apps/panel/src/**/*.tsx` (phần JSX), `web/apps/panel/src/**/*.module.css`, `bridge/public/img/*` |
| Portal người chơi (React) | `web/apps/portal/src/**/*.tsx` (phần JSX), `web/apps/portal/src/**/*.css`, `web/apps/portal/*.html`, `portal/public/map.js`, `skin3d.js`, `portal/public/img/*` |
| Control dùng chung | `web/packages/ui/src/components/**` (`*.tsx` phần JSX, `*.module.css`), `web/packages/ui/src/tokens.css` |
| Launcher (trang hiển thị) | `launcher/src/*.html`, `launcher/src/gate-page.js`, `splash-page.js`, `overlay-page.js`, ảnh trong `launcher/src/` |

Trong các file trên, chỉ được sửa phần **trình bày**:
- HTML markup, CSS, layout, responsive, màu, font, icon, animation.
- Chữ hiển thị (copy), thông báo, trạng thái rỗng / đang tải / lỗi.
- Cách hiển thị dữ liệu **đã có sẵn** trên trang: sắp xếp, lọc, gom nhóm, định dạng số/giờ,
  ẩn/hiện, tab, modal, tooltip.
- Accessibility: nhãn, `aria-*`, focus, tương phản, điều hướng bằng bàn phím.

### 2b. CẤM, kể cả khi nằm trong file được phép

- Đổi URL/endpoint API, method, header, body request, cách đọc response (`fetch`, `/api/...`,
  `/player-api`, `x-admin-token`).
- Đổi logic đăng nhập, token, session, cookie, quyền admin, kiểm tra quyền.
- Đổi logic nghiệp vụ: điều kiện gara, growth, prime/elder, zone, bảng xếp hạng, cách tính
  damage/kill, cài đặt server, lệnh RCON, bất kỳ nút nào gây tác dụng lên game.
- Đổi tên key `localStorage` / `sessionStorage` đang có (người dùng mất cài đặt).
- Đổi hoặc gọi hàm mới của `window.isleLauncher`, `window.gate`, `window.splash`, IPC,
  preload. Trang portal dùng hàm launcher phải kiểm tra hàm đó tồn tại trước (launcher cũ
  không có).
- Nới Content-Security-Policy trong `launcher/src/*.html`.
- Thêm thư viện, CDN, font/script/stylesheet từ bên ngoài. Không sửa `portal/public/vendor/`.
- Xoá hoặc đổi tên `id` / `class` / hàm mà JavaScript hoặc test đang dùng (grep trước khi đổi).
- Chèn dữ liệu vào `innerHTML` mà không qua helper `esc` có sẵn (hoặc dùng `textContent`); trong
  React không dùng `dangerouslySetInnerHTML`.
- Trong file React: đổi lời gọi dữ liệu (`useQuery`, `getJson`, `adminFetch`, `portalGet`, `withToken`),
  `queryKey`, mutation, hook dữ liệu, quyền trong `nav.ts`, `session.tsx`. Chỉ sửa JSX, CSS, chữ hiển thị.

### 2c. File CẤM sửa hoàn toàn

- `bridge/src/**`, `portal/src/**`, `relay/**` (backend, API, auth).
- `web/packages/api/**`, `web/packages/types/**`, `web/apps/*/src/lib/**`, `web/apps/panel/src/app/{nav.ts,session.tsx,router.ts}`,
  `web/*.config.ts`, `web/apps/*/vite.config.ts`, `web/aliases.ts` (dữ liệu, đăng nhập, định tuyến, build).
- `bridge/public/next/**`, `portal/public/next/**` (bản build, sinh ra từ `web/`).
- `launcher/src/main.js`, `preload.js`, `*-preload.js`, `overlay.js`, `login.js`, `ptt.js`.
- `mods/**`, `ue4ss/**`, `config/**` (mod Lua và cấu hình game).
- `scripts/**`, `tests/**`, `*/test/**`.
- `package.json`, `package-lock.json`, `tsconfig.json`, `wrangler.toml` (cả phiên bản launcher).
- `bridge/public/map/**`, `portal/public/vendor/**` (dữ liệu, thư viện).
- `.env`, `.env.example`, `config/*.template`, `AGENTS.md`, `CLAUDE.md`, `docs/**`, `.agent/**`.
- Tuyệt đối không đụng hay xoá bất cứ thứ gì dưới `**/Saved/` (dữ liệu người chơi).

### 2d. Khi UI cần thay đổi ngoài phạm vi

Ví dụ: cần API mới, cần thêm trường dữ liệu, cần hàm launcher mới, cần thêm test.
→ **Không tự làm.** Dừng lại, báo người dùng bằng tiếng Việt: cần thay đổi gì, ở file nào,
vì sao. Để người dùng quyết định.

## 3. Lệnh cấm chạy

- **Không** chạy deploy, git (commit, push, reset, checkout…), ssh, scp, rsync, tunnel.
  Chỉ đề xuất lệnh, người dùng tự chạy.
- **Không** chạy `scripts/*.sh` (deploy, release launcher, test server, restart…).
- **Không** restart, dừng hay khởi động server game; không gửi lệnh RCON.
- **Không** `npm install <gói mới>`, không `npm update`, không build/phát hành launcher.
- **Không** ghi secret thật vào bất kỳ file nào.
- Panel thật qua tunnel (`http://127.0.0.1:8181`) là **server thật**: không mở, không bấm.

## 4. Quy ước giao diện

- Chữ hiển thị bằng tiếng Việt **có dấu**, ngắn, đúng giọng văn hiện có.
- Dùng biến CSS (`--bg`, `--border`, `--accent`…) đã khai báo: panel `web/packages/ui/src/tokens.css`,
  portal `web/apps/portal/src/styles/{portal.css,tokens.css}`, launcher `:root` của từng trang;
  không hard-code màu mới khi đã có biến phù hợp. Mỗi phần có bộ biến riêng, không trộn.
- Giữ cấu trúc hiện có: panel và portal là React (`web/`, React 19 + Vite + CSS Modules), ô chọn /
  số / ngày / màu / tick / thanh trượt luôn là control của `@isle/ui` (không dùng control của trình
  duyệt); launcher là HTML + JS thuần. Không thêm thư viện, framework hay bước build mới.
- Trang người chơi có 2 giao diện (web và trong launcher, `web/apps/portal/src/app/launcher/`):
  sửa một trang phải đúng ở cả hai.
- Portal phải dùng được trên điện thoại (không cuộn ngang). Overlay launcher trong suốt, nhỏ,
  chỉ cập nhật DOM khi dữ liệu thật sự đổi (xem `setText` trong `overlay-page.js`).
- Không được xuống dòng vô lý trong UI và văn bản: cùng một tiêu đề (title, heading, card title)
  hoặc cụm nhãn liền mạch phải nằm trên cùng một dòng, tránh ngắt dòng lưng chừng làm gãy chữ
  (dùng `white-space: nowrap`, `text-wrap: balance` hoặc canh layout cho phù hợp; chỉ xuống dòng
  khi có chủ đích rõ ràng hoặc trên màn hình cực hẹp). Quy tắc bắt buộc của chủ server, 2026-10-05.
- Không dựng mô hình 3D dino bằng code (người dùng đã từ chối).

## 4b. Sửa lỗi hay thêm chức năng: rà soát lại các luồng cũ

Trước khi báo xong:
1. Grep mọi nơi đang dùng thứ vừa sửa (`id`, `class`, hàm, key `localStorage`, nút,
   endpoint mà trang gọi) trong cả `web/apps`, `web/packages`, `portal/public`, `launcher/src`,
   không chỉ file vừa sửa.
2. Với từng luồng đi qua chỗ đó (ví dụ một nút gara: cất, lấy ra, slot admin, dino prime;
   trên điện thoại và máy tính; trong launcher và trình duyệt), nói rõ hành vi có đổi
   không và vì sao vẫn đúng.
3. Test cũ phải vẫn pass, không sửa test cho dễ qua.
4. Báo cáo cuối task liệt kê các luồng đã rà soát và các luồng chưa kiểm tra được.

## 5. Verify sau khi sửa

Chạy các lệnh phù hợp (chỉ đọc/kiểm tra, không deploy):

```bash
# JS rời
node --check portal/public/map.js          # và từng file JS đã sửa

# Test (không cần mạng, không đụng server)
(cd web && npm test && npm run build)  # nếu sửa web/ (panel, portal React): test + typecheck + build
(cd portal && npm test)        # nếu sửa portal/public
(cd launcher && npm test)      # nếu sửa launcher/src
```

Muốn xem giao diện: dùng stack local với **bản sao** dữ liệu theo
`docs/HUONG-DAN-PHAT-TRIEN.md` mục 2a (người dùng lấy dữ liệu, bạn không chạy scp). Kiểm tra cả
màn hình hẹp (~375px) và rộng.

## 6. Báo cáo cuối task

Bằng tiếng Việt, gồm:
1. File đã sửa và thay đổi gì (chỉ phần UI).
2. Đã verify bằng gì, kết quả thật (pass/fail, lỗi nếu có); chưa verify được gì.
3. Lệnh đề xuất để người dùng tự chạy:
   - Panel: `./scripts/deploy.sh --bridge-only`
   - Portal: `./scripts/deploy.sh --portal-only`
   - Launcher: cần tăng version trong `launcher/package.json` (không dùng lại số cũ) rồi phát
     hành theo `docs/HUONG-DAN-PHAT-TRIEN.md` mục 4b, việc này người dùng làm.
4. Việc nào cần thay đổi ngoài phạm vi UI (mục 2d) mà bạn đã **không** làm.
