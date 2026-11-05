# Don't Crash Together

Game sinh tồn co-op 2D (kiểu *Don't Starve Together*) để **học và hiểu sâu kiến trúc hệ thống**.
Bạn và đồng đội là kỹ sư on-call: thu thập tài nguyên, dựng hạ tầng, giữ ánh sáng (giám sát) khi đêm xuống và sống sót qua từng mùa sự cố. Mọi cơ chế sinh tồn đều là một bài học kiến trúc — xem [`docs/MECHANICS.md`](docs/MECHANICS.md).

## Chạy

```bash
npm install          # chỉ cần `ws`
npm start            # http://localhost:3000   (đổi cổng: node server/index.js 8080)
```

- **Vai trò:** chọn 1 trong 6 chuyên môn ở menu (SRE, Backend Dev, DBA, Network Eng., SecOps, Kỹ sư pha chế), mỗi vai trò có kỹ năng bị động riêng; co-op nên phối hợp nhiều vai trò.
- **Chơi một mình**: mở trình duyệt, bấm "Chơi một mình". Mô phỏng chạy trong Web Worker, lưu vào `localStorage`.
- **Co-op** (tối đa 8 người/phòng): ai cũng mở `http://<ip-máy-chủ>:3000`, nhập cùng tên phòng, bấm "Vào phòng co-op". Mỗi phòng là một thế giới authoritative riêng, tự lưu vào `saves/<phòng>.json` (30 giây/lần và khi tắt server). Người chơi quay lại bằng token trong trình duyệt để lấy lại nhân vật.

## Điều khiển

| Phím | Tác dụng |
|---|---|
| WASD / mũi tên | Di chuyển |
| Chuột trái | Thu thập / tấn công / mở bảng điều khiển công trình |
| Space / E | Đánh quái gần nhất / nhặt – thu thập gần nhất |
| 1–9, 0, -, = | Dùng đồ (ăn, trang bị, nạp); chuột phải vào ô để vứt |
| C | Chế tạo & xây (đứng gần Bảng trắng / Phòng lab để mở công thức) |
| M hoặc Tab | Sơ đồ hệ thống sống: node, luồng traffic, biểu đồ, nhật ký post-mortem |
| K | Sổ tay Field Guide (mở khoá khi gặp / xây; mỗi mục mới +1 Điểm kiến thức) |
| Enter | Chat · Esc: hủy / menu · X: dừng hành động · N: bật/tắt âm thanh |

## Học được gì

| Trong game | Khái niệm |
|---|---|
| Ban đêm Gremlin chỉ gặm thứ ngoài vùng sáng | Observability: không giám sát = hỏng trong im lặng |
| Nhiên liệu máy phát tăng theo số component | Chi phí vận hành / cloud bill, failure domain (nguồn điện dự phòng) |
| Tỉnh táo giảm khi hệ thống phức tạp, phục hồi nhờ Runbook | Chi phí của độ phức tạp, alert fatigue |
| Monolith → LB + nhiều App → Cache → Queue → Replica → CDN | Scale ngang vs dọc, SPOF, backpressure, đọc/ghi |
| Round-robin / least-conn / hash; retry, backoff, circuit breaker | Cân bằng tải, retry storm, fail fast |
| Cache TTL, jitter, coalescing | Stampede, cold start, staleness vs hit ratio |
| DB sync/async, failover tự động/quorum, partition | CAP, split-brain, RPO |
| 11 loại sự cố + post-mortem dựa trên kiến trúc thật | Pattern thất bại và cách giảm blast radius |
| Chaos Lab | Chaos engineering / game day |

## Cấu trúc mã

```
shared/            lõi mô phỏng thuần (chạy y hệt trong Node và Web Worker)
  data.js          vật phẩm, công thức, thông số component, hằng số
  world.js         thực thể, người chơi, chế tạo, điện/ánh sáng, nhu cầu sinh tồn, lệnh
  flow.js          mô phỏng luồng request qua đồ thị (hàng đợi, retry, breaker, replication, quorum)
  incidents.js     director sự cố + chẩn đoán post-mortem
  mobs.js tips.js  AI quái, cố vấn theo ngữ cảnh
  room.js          phòng: nhận input, mô phỏng 20 Hz, broadcast delta snapshot
  codex_*.js       nội dung Field Guide (48 mục)
server/index.js    HTTP tĩnh + WebSocket + lưu thế giới
public/            client canvas 2D + HUD (render.js, art.js procedural, hud/inspector/dashboard/codexui)
tools/             sim-test.js, incident-test.js, db-test.js (headless), art-preview.html
```

Kiến trúc mạng (cũng là một bài học): client chỉ gửi **input/lệnh**; server **authoritative** mô phỏng 20 Hz và gửi **delta snapshot** (chỉ entity thay đổi, so sánh bằng chuỗi JSON đã gửi); client nội suy vị trí. Cùng một `Room` chạy trong Node (WebSocket) hoặc Web Worker (solo) — chỉ khác transport.

## Kiểm thử headless

```bash
node tools/sim-test.js 600 idle      # chạy 600 giây thế giới, in chỉ số mỗi 30s
npm test                             # hồi quy: token/lệnh độc hại không làm sập tick, save/load giữ bản đồ
node tools/incident-test.js          # dựng kiến trúc đầy đủ, kích hoạt từng sự cố + post-mortem
node tools/db-test.js                # failover / split-brain / quorum / sync
DCT_DEBUG=1 npm start                # bật lệnh debug (give/kit/build/inc...) để thử nhanh
```

## Tiến trình bằng học tập & công cụ trace
- **Điểm kiến thức (KP):** công thức nâng cao phải học bằng KP (kiếm từ sổ tay và post-mortem) — xem `docs/MECHANICS.md`.
- **Theo dõi request:** trong Sơ đồ (M), gửi một request tĩnh/đọc/ghi và xem nó đi qua từng node, mất bao lâu, chết ở đâu. `node tools/trace-test.js` kiểm thử headless.
