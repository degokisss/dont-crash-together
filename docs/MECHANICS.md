# Don't Crash Together — Cơ chế game (tài liệu thiết kế)

Game sinh tồn co-op 2D top-down kiểu *Don't Starve Together*, nhưng "thế giới" bạn phải sống sót là
**một hệ thống phần mềm đang có người dùng**. Mọi cơ chế sinh tồn đều ánh xạ sang một khái niệm kiến trúc:

| Don't Starve | Don't Crash Together | Bài học |
|---|---|---|
| Đêm tối / Charlie | Đêm: **Gremlin (bug)** chỉ gặm những gì nằm ngoài vùng sáng | *Observability*: cái gì không quan sát được thì sẽ hỏng trong im lặng |
| Lửa trại | **Đèn giám sát (Monitoring)** + máy phát điện | Vùng sáng = vùng có metrics |
| Đói | **Năng lượng (cà phê)** của kỹ sư; **nhiên liệu** máy phát = chi phí cloud | Chi phí vận hành |
| Sanity | **Tải nhận thức (complexity)**: càng nhiều component, càng thiếu runbook → càng điên, ảo giác "cảnh báo giả" | *Alert fatigue*, chi phí của độ phức tạp |
| Hound waves | **Sự cố**: spike traffic, DDoS, crash, rò bộ nhớ, cache stampede, partition... | Mỗi sự cố dạy một pattern |
| Mùa | Thu = ổn định, Đông = DDoS, Xuân = viral, Hè = Black Friday | Tải thay đổi theo chu kỳ |
| Science Machine | Bảng trắng → Phòng lab kiến trúc → Chaos Lab | Tiến hoá kiến trúc từ monolith → scale-out |
| Chết / hồi sinh | Kỹ sư kiệt sức → "ngất", hồi sinh sau 12s tại Gateway | |

## Vòng chơi
1. Thu thập tài nguyên (cáp, linh kiện, silicon, khung rack, đồng, sợi quang, than, cà phê, nấm).
2. Chế tạo công cụ, đặt component, nối cáp giữa chúng.
3. Giữ máy phát điện có nhiên liệu, giữ đèn giám sát sáng, giữ bản thân no & tỉnh táo.
4. Người dùng tăng khi SLO đạt; mỗi ngày kết thúc có "báo cáo ngày". Tụt dưới 6 người dùng = phá sản.
5. Mỗi sự cố kết thúc sinh một **Post-mortem** chẩn đoán dựa trên kiến trúc thật của bạn.
6. **Field Guide (Codex)** mở khoá khi bạn gặp/đặt một thứ gì đó.

Hệ thống khởi đầu là một **monolith**: `Gateway → App → Database`, 24 người dùng.

## Mô hình traffic
- Mỗi người dùng ≈ 1.2 req/s. Traffic hợp lệ: 30% **tĩnh** (s), 50% **đọc** (r), 20% **ghi** (w). Lớp thứ 4 là **độc hại** (b) từ DDoS.
- Nhu cầu theo thời gian: ngày ×1.0, hoàng hôn ×1.25 (giờ cao điểm), đêm ×0.45. Mùa: Thu 1.0, Đông 0.9, Xuân 1.15, Hè 1.35.
- Người dùng thử lại (retry) khi request thất bại → traffic thực tế lớn hơn nhu cầu (retry amplification).
- **SLO**: ≥ 98.5% thành công và p99 ≤ 1500 ms. Cuối mỗi ngày: SLO đạt ≥ 92% thời gian → +12% user (Xuân +25%); 75–92% → giữ nguyên; 50–75% → −10%; <50% → −25%.

## Luồng request qua đồ thị (mô phỏng mỗi 0.5 giây)
Mỗi component có **công suất** (đơn vị công việc/s) và chi phí theo lớp request. Utilization ρ = tải/công suất.
- Độ trễ node = base / (1 − min(ρ, 0.95)) + backlog/cap (hàng đợi M/M/1 đơn giản). Khi ρ > 1, backlog đầy và request bị **drop** (503).
- Độ trễ p50 ≈ 0.7·mean, p99 ≈ 4.6·mean (đuôi mũ). Xác suất timeout phía client (3 s) = exp(−3000/mean).
- Lỗi và timeout được người dùng retry → thêm tải ở tick sau → có thể **retry storm**.

### Các component
| Component | Vai trò & hành vi mô phỏng | Cấu hình |
|---|---|---|
| **API Gateway** | Điểm vào. Chỉ chuyển tiếp tới **một** đích khoẻ đầu tiên trong danh sách cáp (failover thứ tự). Lớp *tĩnh* đi qua CDN nếu có. | **Rate limit** (req/s, loại bỏ cả lớp hợp lệ tương ứng), **WAF** (cần module, chặn ~95% request độc hại) |
| **CDN** | Phục vụ lớp tĩnh ở edge, hit ~92% sau khi ấm (warm-up). Miss chuyển về origin (cáp đầu tiên). | — |
| **Load Balancer** | Chia tải cho nhiều App. Phát hiện node chết sau ~4 s (health check) → trong khoảng đó vẫn gửi vào node chết → lỗi. | Thuật toán: **Round-robin** (chia đều bất kể sức mạnh), **Least-connections** (theo công suất còn trống), **Hash/sticky** (có skew: 1 node nhận nhiều hơn). **Autoscaler** (module): thêm instance ảo khi util > 70% (khởi động 15 s), tốn điện. |
| **App Server** | Xử lý logic. Đọc → Cache (nếu có cáp tới cache) rồi DB; ghi → Queue (nếu có) hoặc DB. Nhiều App không có LB = chỉ App đầu tiên nhận tải. | Tier 1–3 (**scale up cần reboot** ~10 s), **retries** 0–3, **backoff+jitter**, **circuit breaker** (mở khi >50% lỗi từ downstream; fail fast, thăm dò 5%), **Deploy** (rủi ro 30% bản lỗi → lỗi ~40% request của node đó, không thấy nếu không giám sát), **Rollback**, **Restart** |
| **Cache** | Read-through: hit trả ngay, miss chuyển tới DB. Hit ratio phụ thuộc tier & TTL. Khởi động nguội mất ~20 s mới ấm. Không jitter → mọi key hết hạn cùng lúc mỗi chu kỳ TTL → **stampede** (hit ≈ 10% trong ~3 s). | TTL 10/30/60 s (dài = hit cao hơn nhưng dữ liệu cũ hơn), **Jitter**, **Request coalescing**, tier |
| **Message Queue** | Nhận ghi nhanh (ack sớm), xả dần vào DB theo công suất DB còn trống (backpressure). Backlog đầy → từ chối ghi. Đo **lag**. | tier |
| **Database** | Công suất đọc/ghi chung (đọc cost 2, ghi cost 5). Đọc có thể chia cho replica. Ghi chỉ vào **leader**. Đĩa đầy → ghi thất bại. | Tier, **shards** (1–4; có skew nên không scale tuyến tính), **sync/async replication**, **failover** (tắt / tự động / quorum), **retention** (giảm tốc độ đầy đĩa), **key salting** (giảm skew), **Archive** (dọn đĩa) |
| **Read Replica** | Nhận đọc từ DB primary, độ trễ sao chép tăng khi primary quá tải. Có thể được thăng cấp làm leader khi primary chết. | tier |

### Độ bền dữ liệu
Khi leader chết: ghi chưa được sao chép (async) bị **mất**. Sync replication không mất dữ liệu nhưng ghi thất bại nếu replica không với tới được (CP).
**Split-brain**: partition + failover tự động + async → hai leader nhận ghi → khi nối lại, xung đột = mất dữ liệu. **Quorum** mode chỉ thăng cấp khi đa số node với tới nhau (cần ≥ 3 node: primary + 2 replica).

## Sinh tồn
- Chỉ số: ❤ Máu, ☕ Năng lượng (đói), 🧠 Tỉnh táo. Đói 0 → mất máu. Tỉnh táo <30%: màn hình rung/méo, số liệu ở thẻ người dùng bị nhiễu; <22%: báo động giả xuất hiện (rồi tự nhận là sai); <15%: "cảnh báo giả" (phantom) hiện hình và tấn công.
- Tỉnh táo giảm theo **độ phức tạp** của hệ thống (số component & tuỳ chọn) chia cho số kỹ sư online, giảm thêm trong bóng tối và khi có sự cố đang diễn ra. Giá Runbook, Vịt cao su, đồ ăn ngon giúp hồi.
- **Điện**: máy phát điện (bán kính ~8 ô) cấp điện cho component. Mỗi component tiêu thụ watt; máy phát đốt nhiên liệu theo tổng watt. Hết nhiên liệu → mất điện → component tắt. Có thể có nhiều máy phát chồng lấn (dự phòng).
- **Ánh sáng/giám sát**: Máy phát (nhỏ) và Đèn giám sát (lớn) tạo vùng sáng. Trong vùng sáng (đang có điện): thấy metrics của component. Ngoài vùng sáng ban đêm: Gremlin gặm công trình (hp → 0 = crash), người chơi đứng trong bóng tối bị cắn.
- Chết → rớt đồ → hồi sinh tại Gateway sau 12 s.

## Sự cố (director chọn theo mùa, tiền điều kiện kiến trúc và độ khó tăng theo ngày)
| id | Tên | Hiệu ứng | Biện pháp |
|---|---|---|---|
| `spike` | Traffic spike / Thundering herd | Nhu cầu ×2–4,5 (tăng theo ngày) trong ~50 s | Scale-out + LB, autoscaler, rate limit (load shedding), queue, CDN, cache |
| `stampede` | Cache stampede | Hit ratio cache về ~10% trong ~12 s | Jitter TTL, request coalescing, DB đủ mạnh/replica |
| `crash` | Node crash | Một component ngẫu nhiên chết tới khi reboot | Dư thừa (N+1), LB health check, failover DB, runbook reboot nhanh |
| `leak` | Rò bộ nhớ | Một App tăng mem tới OOM | Giám sát, restart định kỳ/rolling, deploy bản vá |
| `ddos` | DDoS / botnet | Bot vật lý + traffic độc hại ∝ số bot | Tháp tường lửa, WAF, rate limit, giết bot |
| `partition` | Network partition | Một cáp bị cắt ~25 s | Đường dự phòng, sync vs async, quorum |
| `hotkey` | Hot key / hot shard | Skew DB & LB-hash tăng | Cache, least-connections, key salting / consistent hashing |
| `diskfull` | Log nổ đĩa | Đĩa DB tăng vọt | Retention, Archive, giám sát dung lượng |
| `baddeploy` | Deploy lỗi | Bản deploy mới lỗi | Deploy từng node (canary), giám sát, rollback |
| `outage` | Mất điện lưới | Một máy phát bị sập 30 s | Hai máy phát chồng lấn, phân tán component |
| `analytics` | Truy vấn báo cáo nặng | Tải DB tăng đột biến (trên replica nếu có) | Cô lập workload bằng read replica |

## Post-mortem
Khi sự cố kết thúc, game sinh báo cáo: tác động (thời gian, % lỗi tối đa, p99 tối đa, người dùng ảnh hưởng), danh sách kiểm tra *"bạn có X không?"* (✓/✗ kèm lý do thật từ trạng thái hệ thống lúc đó) và gợi ý Codex.

## Chaos Lab
Công trình cấp 3: cho phép kích hoạt thủ công một sự cố đã gặp ("game day") — sự cố không bị tính vào SLO ngày và không làm mất user. Chỗ an toàn để thử nghiệm kiến trúc.

## Netcode (cũng là bài học kiến trúc)
- Một server **authoritative**: client chỉ gửi *input*; server mô phỏng 20 Hz và broadcast **delta snapshot** (chỉ entity đổi); client nội suy.
- Cùng một lõi mô phỏng chạy trong Node (co-op) hoặc trong Web Worker (solo) — chỉ khác transport.
- Server lưu snapshot định kỳ (`saves/`), người chơi quay lại dùng token.
