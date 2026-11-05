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
| **API Gateway** | Điểm vào. Chỉ chuyển tiếp tới **một** đích khoẻ đầu tiên trong danh sách cáp (failover thứ tự). Lớp *tĩnh* đi qua CDN nếu có, nếu không thì thẳng tới **S3** nếu có. | **Rate limit** (req/s, loại bỏ cả lớp hợp lệ tương ứng), **WAF** (cần module, chặn ~95% request độc hại) |
| **CDN** | Phục vụ lớp tĩnh ở edge, hit ~92% sau khi ấm (warm-up). Miss chuyển về origin (đích khoẻ đầu tiên trong cáp: S3, K8s, LB hoặc App). | — |
| **Load Balancer** | Chia tải cho nhiều App. Phát hiện node chết sau ~4 s (health check) → trong khoảng đó vẫn gửi vào node chết → lỗi. | Thuật toán: **Round-robin** (chia đều bất kể sức mạnh), **Least-connections** (theo công suất còn trống), **Hash/sticky** (có skew: 1 node nhận nhiều hơn). **Autoscaler** (module): thêm instance ảo khi util > 70% (khởi động 15 s), tốn điện. |
| **Kubernetes Cluster** (2×1, 4 W, độ phức tạp +6) | Ingress + scheduler cho các App: chia tải theo công suất còn trống, readiness probe phát hiện pod chết sau ~1 s (LB ~4 s). Với App **đã đóng container** (Module Docker): **tự chữa** (pod crash/OOM được dựng lại sau ~6 s, không cần kỹ sư), **HPA** (thêm instance khi util nhóm > 70%, khởi động ~8 s, tối đa +6; bớt khi < 30% trong 30 s), **rolling update** (deploy chỉ down ~1 s) và **tự rollback** bản deploy lỗi sau ~10 s. App chưa đóng container chỉ được chia tải. Control plane là SPOF và không tự chữa. Chi phí xử lý 0.4/request (LB: 0.3). | Công thức ở Chaos Lab, 5 KP |
| **App Server** | Xử lý logic. Đọc → Cache (nếu có cáp tới cache) rồi DB; ghi → Queue (nếu có) hoặc DB. Nhiều App không có LB/K8s = chỉ App đầu tiên nhận tải. | Tier 1–3 (**scale up cần reboot** ~10 s), **retries** 0–3, **backoff+jitter**, **circuit breaker** (mở khi >50% lỗi từ downstream; fail fast, thăm dò 5%), **Deploy** (rủi ro 30% bản lỗi → lỗi ~40% request của node đó, không thấy nếu không giám sát), **Rollback**, **Restart**, **Module Docker** (container: reboot/restart nhanh gấp đôi, rủi ro deploy lỗi 30% → 12%, công suất −4% do overhead runtime, độ phức tạp +1) |
| **Cache** | Read-through: hit trả ngay, miss chuyển tới DB. Hit ratio phụ thuộc tier & TTL. Khởi động nguội mất ~20 s mới ấm. Không jitter → mọi key hết hạn cùng lúc mỗi chu kỳ TTL → **stampede** (hit ≈ 10% trong ~3 s). | TTL 10/30/60 s (dài = hit cao hơn nhưng dữ liệu cũ hơn), **Jitter**, **Request coalescing**, tier |
| **Message Queue** | Nhận ghi nhanh (ack sớm), xả dần vào DB theo công suất DB còn trống (backpressure). Backlog đầy → từ chối ghi. Đo **lag**. | tier |
| **Object Storage (S3)** | Phục vụ lớp *tĩnh* như origin: chi phí 0.1/request (App: 1), công suất 6000, độ trễ nền 45 ms (chậm hơn CDN edge ~8 ms). Nếu chết, nơi gọi chuyển sang origin kế tiếp sau health check ~3 s. Đích **backup** của DB (xem dưới). | Công thức ở Phòng lab, 2 KP |
| **Database** | Công suất đọc/ghi chung (đọc cost 2, ghi cost 5). Đọc có thể chia cho replica. Ghi chỉ vào **leader**. Đĩa đầy → ghi thất bại. | Tier, **shards** (1–4; có skew nên không scale tuyến tính), **sync/async replication**, **failover** (tắt / tự động / quorum), **retention** (giảm tốc độ đầy đĩa), **key salting** (giảm skew), **Backup** (tắt / hằng ngày / hằng giờ), **Archive** (dọn đĩa), **Khôi phục** từ backup, **cáp tới S3** (backup mỗi 30 s, đĩa đầy chậm hơn 25%) |
| **Read Replica** | Nhận đọc từ DB primary, độ trễ sao chép tăng khi primary quá tải. Có thể được thăng cấp làm leader khi primary chết. | tier |

### Độ bền dữ liệu
Khi leader chết: ghi chưa được sao chép (async) bị **mất**. Sync replication không mất dữ liệu nhưng ghi thất bại nếu replica không với tới được (CP).

**Split-brain**: partition + failover tự động + async → hai leader nhận ghi → khi nối lại, xung đột = mất dữ liệu. **Quorum** mode chỉ thăng cấp khi đa số node với tới nhau (cần ≥ 3 node: primary + 2 replica).

### Backup & khôi phục
Replica sao chép cả lỗi lẫn lệnh xoá nhầm nên **không thay được backup**. Cấu hình **Backup** của DB (bảng `BACKUP` trong `shared/data.js`):

| Backup | Chu kỳ snapshot | Snapshot chạy | IO thêm lúc chạy | Đĩa mỗi snapshot (DB tier 1) |
|---|---|---|---|---|
| Tắt | — | — | — | — (xoá mọi snapshot đang có) |
| Hằng ngày | 150 s (một ngày game) | 8 s | +90 | 0,8% |
| Hằng giờ | 30 s | 4 s | +60 | 0,5% |

- Snapshot đầu tiên chạy ngay khi bật Backup. Mỗi snapshot hoàn tất đặt lại bộ đếm **ghi chưa được bảo vệ**. Số bản ghi có nguy cơ mất (**RPO** thực tế) = ghi chưa được bảo vệ × 0,05; thẻ DB hiện "Backup gần nhất" và "Chưa được bảo vệ". Khi Backup tắt, mọi ghi từ đầu game đều chưa được bảo vệ.
- Chi phí: mỗi snapshot chiếm thêm đĩa (chia theo dung lượng đĩa của tier; **Retention** giảm còn 40%) và cộng IO vào DB lúc chạy, nên backup dày hơn tốn đĩa và IO hơn. Snapshot dừng khi DB đang chết/reboot hoặc dữ liệu đang hỏng (không ghi đè điểm khôi phục sạch bằng dữ liệu hỏng).
- Sự cố `dataloss` đánh dấu một DB là **hỏng dữ liệu**: 40% request đọc/ghi thất bại, cả trên DB lẫn replica. Failover sang replica **không** chữa được vì dữ liệu hỏng đã được sao chép.
- **Khôi phục từ backup** (lệnh `c_restore`, đứng gần DB) cần đã có snapshot (từ Backup hoặc từ cáp S3) và dữ liệu đang hỏng. DB reboot 12 s (**DBA** 6 s, **RTO**), mất các ghi sau snapshot cuối (tính vào dữ liệu mất và trừ người dùng như failover mất dữ liệu), hết hỏng và sự cố kết thúc. Không có snapshot: khôi phục bị từ chối, và sau 60 s cả đội tự dựng lại dữ liệu từ đầu, mất toàn bộ ghi chưa được bảo vệ.
- Crash DB kèm hỏng đĩa (30% số lần crash DB) dùng cùng công thức, nên có snapshot gần đây thì mất ít hơn nhiều.
- **Backup sang S3**: DB có cáp tới Object Storage (còn sống, không bị cắt) cũng snapshot mỗi 30 s, độc lập với cấu hình Backup: bản chụp nằm ở S3 nên tắt Backup không xoá được. Dữ liệu cold offload sang S3 còn làm đĩa đầy chậm hơn 25%. Snapshot S3 cũng đặt lại bộ đếm ghi chưa được bảo vệ, tính là điểm khôi phục (`c_restore` dùng snapshot mới nhất của hai nguồn), và cũng không chạy khi dữ liệu đang hỏng. Không có Backup lẫn S3, "dữ liệu chưa backup" tích luỹ mãi.

### Cảnh báo & on-call
Đèn giám sát có cấu hình **Mức cảnh báo** (`lantern.cfg.alert`, bảng `ALERT` trong `shared/data.js`, mặc định **Vừa**). Mỗi 0,5 s đèn đánh giá số liệu của từng component trong vùng của nó (đúng số liệu bạn thấy ở inspector). Component ngoài mọi vùng đèn, hoặc trong vùng đèn đang mất điện/để Tắt, **không bao giờ page**. Component nằm trong nhiều vùng dùng đèn nhạy nhất đang bật alert.

| Mức | Lỗi (node) | p99 (node) | Utilization | Đĩa DB | Phải vi phạm liên tục |
|---|---|---|---|---|---|
| Tắt | — | — | — | — | — |
| Nhạy | ≥ 0,5% | ≥ 300 ms | ≥ 50% | ≥ 50% | 2 s |
| Vừa | ≥ 5% | ≥ 1200 ms | ≥ 92% | ≥ 85% | 6 s |
| Chặt | ≥ 30% | ≥ 4500 ms | ≥ 120% | ≥ 97% | 20 s |

- Mỗi cặp (quy tắc, node) là một máy trạng thái `ok → pending → firing → acked` trong một registry duy nhất (`w.alerts`). Vi phạm → `pending`; đủ thời gian `for` thì `firing` và page; hết vi phạm liên tục 10 s thì tự đóng (chống nhấp nháy). Một điều kiện chỉ page một lần (khoá `quy tắc:node`), và nhiều quy tắc cùng vi phạm trên một node chỉ page một lần (alert nặng hơn, cảnh báo → lỗi, vẫn page lại). Node đang reboot được coi là bảo trì, không page. Alert đang kêu được lưu cùng thế giới nên tải lại không page lại.
- **On-call**: đúng một người chơi online là người on-call, đổi sang người kế tiếp mỗi ngày mới, hoặc nhận ca bằng lệnh `c_oncall` (nút "Nhận ca" ở bảng Pager). Page hiện nổi bật (toast + âm thanh) cho người on-call, và là thông báo nhỏ ("X đang bị page") cho những người khác.
- **Ack** (`c_ack`, phím V hoặc nút Ack ở Pager) phải trong **20 s**. Quá hạn thì alert **escalate**: cả đội bị page, người on-call mất **15** tỉnh táo, và từ đó ai cũng ack được. Trước khi escalate chỉ người on-call ack được. Giao ca đưa các page chưa ack sang người mới với cửa sổ ack mới.
- **Báo động giả**: page kêu khi không có sự cố nào đang chạy và SLO vẫn đạt. Mỗi page giả làm người on-call mất **4** tỉnh táo. Nhạy kêu sớm nhưng hay báo giả; Chặt không báo giả nhưng chỉ kêu khi người dùng đã lỗi (ví dụ crash App duy nhất: Nhạy ~3 s, Vừa ~7 s, Chặt ~21 s sau khi crash, SLO vỡ ngay từ giây 0). `node tools/alert-sim.js` in bảng so sánh các mức trên cùng kịch bản có seed.
- Số liệu của sự cố: `detectedAt` (alert đầu tiên kêu trong sự cố) và `ackedAt`; post-mortem có thêm các dòng *Alert phát hiện trước khi SLO vỡ*, *MTTD*, *MTTA* và *Báo động giả* (số page giả kể từ sự cố trước), kèm lý do thật khi không có alert nào (alert Tắt, node ngoài vùng đèn, ngưỡng quá chặt).

## Sinh tồn
- Chỉ số: ❤ Máu, ☕ Năng lượng (đói), 🧠 Tỉnh táo. Đói 0 → mất máu. Tỉnh táo <30%: màn hình rung/méo, số liệu ở thẻ người dùng bị nhiễu; <22%: báo động giả xuất hiện (rồi tự nhận là sai); <15%: "cảnh báo giả" (phantom) hiện hình và tấn công.
- Tỉnh táo giảm theo **độ phức tạp** của hệ thống (số component & tuỳ chọn) chia cho số kỹ sư online, giảm thêm trong bóng tối và khi có sự cố đang diễn ra. Giá Runbook, Vịt cao su, đồ ăn ngon giúp hồi.
- **Điện**: máy phát điện (bán kính ~8 ô) cấp điện cho component. Mỗi component tiêu thụ watt; máy phát đốt nhiên liệu theo tổng watt. Hết nhiên liệu → mất điện → component tắt. Có thể có nhiều máy phát chồng lấn (dự phòng).
- **Ánh sáng/giám sát**: Máy phát (nhỏ) và Đèn giám sát (lớn) tạo vùng sáng. Trong vùng sáng (đang có điện): thấy metrics của component. Ngoài vùng sáng ban đêm: Gremlin gặm công trình (hp → 0 = crash), người chơi đứng trong bóng tối bị cắn.
- Chết → rớt đồ → hồi sinh tại Gateway sau 12 s.

## Sự cố (director chọn theo mùa, tiền điều kiện kiến trúc và độ khó tăng theo ngày)
| id | Tên | Hiệu ứng | Biện pháp |
|---|---|---|---|
| `spike` | Traffic spike / Thundering herd | Nhu cầu ×2–4,5 (tăng theo ngày) trong ~50 s | Scale-out + LB/Kubernetes, autoscaler/HPA, rate limit (load shedding), queue, CDN/S3, cache |
| `stampede` | Cache stampede | Hit ratio cache về ~10% trong ~12 s | Jitter TTL, request coalescing, DB đủ mạnh/replica |
| `crash` | Node crash | Một component ngẫu nhiên chết tới khi reboot | Dư thừa (N+1), LB health check, failover DB, backup S3, runbook reboot nhanh, Kubernetes tự chữa App đã đóng container |
| `leak` | Rò bộ nhớ | Một App tăng mem tới OOM | Giám sát, restart định kỳ/rolling, deploy bản vá, Kubernetes dựng lại pod bị OOM-kill |
| `ddos` | DDoS / botnet | Bot vật lý + traffic độc hại ∝ số bot | Tháp tường lửa, WAF, rate limit, giết bot |
| `partition` | Network partition | Một cáp bị cắt ~25 s | Đường dự phòng, sync vs async, quorum |
| `hotkey` | Hot key / hot shard | Skew DB & LB-hash tăng | Cache, least-connections, key salting / consistent hashing |
| `diskfull` | Log nổ đĩa | Đĩa DB tăng vọt | Retention, Archive, offload sang S3, giám sát dung lượng |
| `baddeploy` | Deploy lỗi | Bản deploy mới lỗi | Deploy từng node (canary), container (30% → 12% rủi ro), giám sát, rollback; Kubernetes rolling update + tự rollback |
| `outage` | Mất điện lưới | Một máy phát bị sập 30 s | Hai máy phát chồng lấn, phân tán component |
| `analytics` | Truy vấn báo cáo nặng | Tải DB tăng đột biến (trên replica nếu có) | Cô lập workload bằng read replica |
| `dataloss` | Xóa nhầm dữ liệu (DROP TABLE) | Từ ngày 6: một DB hỏng dữ liệu, 40% đọc/ghi lỗi tới khi khôi phục; replica và failover không chữa được | Backup + Khôi phục, giám sát DB để phát hiện sớm, đừng coi replica là backup |

## Điểm kiến thức (KP)
Công thức nâng cao (Cache, Queue, CDN, Replica, S3, Module Docker, Tháp tường lửa, Module WAF, Chaos Lab, Module Autoscaler, Kubernetes) phải được **học** bằng KP trước khi chế/đặt (vẫn cần đứng gần Phòng lab; Kubernetes và Module Autoscaler cần Chaos Lab). KP dùng chung cả đội.
- Khởi đầu 3 KP. +1 mỗi mục sổ tay mới mở khoá. Sau mỗi post-mortem: +1 cho mỗi biện pháp phòng thủ đạt, +2 nếu đạt đủ. Game day chỉ thưởng (một nửa) lần đầu mỗi loại sự cố.
- Chi phí: Cache/Queue/S3/Module Docker 2, CDN/Replica/Tháp/WAF 3, Chaos Lab/Autoscaler 4, Kubernetes 5. Bản lưu cũ giữ nguyên các công thức đã có.

## Theo dõi một request
Trong Sơ đồ (M) bấm Tĩnh/Đọc/Ghi để gửi một request mẫu: server lấy mẫu một đường đi theo đúng xác suất của mô phỏng hiện tại (chia tải, cache hit/miss, drop do quá tải, retry, breaker, cáp đứt, rate limit...) và hiện từng bước với thời gian cộng dồn. Kèm mẫu 60 request (tỉ lệ thành công, p50/p99, lỗi hay gặp nhất) và gợi ý sổ tay. Node ngoài vùng Đèn giám sát chỉ hiện "???".

## Post-mortem
Khi sự cố kết thúc, game sinh báo cáo: tác động (thời gian, % lỗi tối đa, p99 tối đa, người dùng ảnh hưởng), danh sách kiểm tra *"bạn có X không?"* (✓/✗ kèm lý do thật từ trạng thái hệ thống lúc đó) và gợi ý Codex. Mọi sự cố đều có thêm các dòng về cảnh báo (xem *Cảnh báo & on-call*).

## Chaos Lab
Công trình cấp 3: cho phép kích hoạt thủ công một sự cố đã gặp ("game day") — sự cố không bị tính vào SLO ngày và không làm mất user. Chỗ an toàn để thử nghiệm kiến trúc.

## Netcode (cũng là bài học kiến trúc)
- Một server **authoritative**: client chỉ gửi *input*; server mô phỏng 20 Hz và broadcast **delta snapshot** (chỉ entity đổi); client nội suy.
- Cùng một lõi mô phỏng chạy trong Node (co-op) hoặc trong Web Worker (solo) — chỉ khác transport.
- Server lưu snapshot định kỳ (`saves/`), người chơi quay lại dùng token.
