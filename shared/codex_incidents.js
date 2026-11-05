// Field Guide (Codex): sự cố & khái niệm kiến trúc. Nội dung tiếng Việt, thuật ngữ kỹ thuật giữ nguyên tiếng Anh.
// Khớp với docs/MECHANICS.md. `see` có thể trỏ tới id của CODEX_COMPONENTS (comp-*, concept-slo...).

export const CODEX_INCIDENTS = [
  // ───────────────────────── INCIDENTS ─────────────────────────
  {
    id: 'inc-spike', cat: 'incident',
    title: 'Traffic spike / Thundering herd',
    summary: 'Lượng request tăng vọt gấp nhiều lần trong thời gian ngắn, vượt xa công suất đã provision.',
    body: `<p>Một chiến dịch marketing, bài viral hay flash sale khiến nhu cầu tăng đột ngột. Khi utilization ρ tiến gần 1, độ trễ hàng đợi tăng phi tuyến (~1/(1−ρ)); request chậm bị timeout, client retry, và retry lại cộng thêm tải đúng lúc hệ thống yếu nhất. Vòng phản hồi dương này biến một đợt tăng tải thành sập hoàn toàn.</p><p>Trong game: <code>spike</code> nhân nhu cầu ×2–4,5 (tăng theo ngày) trong ~45–55 s. Khi ρ &gt; 1, backlog đầy và node trả 503; người dùng retry nên traffic thực lớn hơn nhu cầu. Autoscaler chỉ thêm instance khi util &gt; 70% và cần 15 s khởi động, nên không kịp đỡ đỉnh đầu tiên.</p><ul><li><b>Rate limit</b> ở Gateway giữ phần traffic còn lại khoẻ.</li><li><b>CDN</b> hấp thụ lớp tĩnh, <b>Queue</b> hấp thụ ghi, <b>Cache</b> giảm đọc xuống DB.</li></ul>`,
    pros: [], cons: [],
    real: 'Các đợt Black Friday/flash sale và các sự kiện lớn thường xuyên làm sập trang thương mại điện tử không kịp scale; đây là kịch bản kinh điển mà autoscaling và load shedding sinh ra để xử lý.',
    tryIt: 'Đặt autoscaler + rate limit rồi chạy Chaos Lab spike; so sánh % lỗi lúc đỉnh với lần không có chúng.',
    see: ['concept-autoscaling', 'concept-load-shedding', 'concept-retry-storm', 'comp-lb', 'comp-cdn', 'concept-utilization'],
    symptoms: ['Utilization của Gateway/App vọt lên >90% và đổi màu đỏ', 'p99 tăng vọt vượt 1500 ms trước khi error rate tăng', 'Error rate (503) tăng, traffic thực tế lớn hơn nhu cầu do retry', 'Backlog của Queue/App đầy dần'],
    mitigations: [
      { name: 'Autoscaler', how: 'Bật module autoscaler trên Load Balancer để tự thêm instance khi util > 70%.', tradeoff: 'Khởi động 15 s nên đỡ đỉnh đầu chậm; tốn thêm điện/chi phí cloud.' },
      { name: 'Rate limit', how: 'Đặt rate limit (req/s) ở Gateway để loại bỏ phần vượt quá, bảo vệ phần còn lại.', tradeoff: 'Một phần người dùng hợp lệ bị từ chối; đặt quá thấp thì tự gây thiệt hại.' },
      { name: 'Queue cho ghi', how: 'App đẩy ghi vào Message Queue để ack sớm và xả dần vào DB.', tradeoff: 'Ghi chỉ eventual; backlog đầy vẫn bị từ chối, và thêm một component phải vận hành.' },
      { name: 'CDN + Cache', how: 'CDN gánh lớp tĩnh, Cache gánh lớp đọc, giảm công việc thực sự đến origin/DB.', tradeoff: 'Dữ liệu có thể cũ; cache nguội gây stampede.' }
    ]
  },
  {
    id: 'inc-stampede', cat: 'incident',
    title: 'Cache stampede (Dogpile)',
    summary: 'Nhiều key hết hạn cùng lúc làm cache miss hàng loạt và dồn toàn bộ tải đọc xuống database.',
    body: `<p>Cache che chắn DB nhờ hit ratio cao. Nếu nhiều key được set cùng TTL cùng thời điểm, chúng hết hạn đồng thời; mọi request đồng loạt miss, và mỗi request lại tự tính lại cùng một giá trị từ DB. DB bị quá tải, truy vấn chậm đi, khiến việc nạp lại cache cũng chậm và kéo dài thời gian miss — một vòng xoáy tự khuếch đại.</p><p>Trong game: không bật <b>Jitter</b>, mọi key hết hạn cùng lúc mỗi chu kỳ TTL; sự cố <code>stampede</code> đưa hit ratio về ~10% trong ~12 s. DB phải gánh tải đọc (cost 2 mỗi đọc) mà bình thường cache đã chặn. <b>Request coalescing</b> gộp nhiều miss cùng key thành một truy vấn, còn replica chia bớt đọc.</p>`,
    pros: [], cons: [],
    real: 'Hiện tượng "dogpile"/thundering herd khi cache hết hạn là mẫu lỗi được ghi nhận rộng rãi; Facebook mô tả cơ chế lease trong bài báo Memcache của họ (NSDI 2013) để chống nó.',
    tryIt: 'Tắt Jitter, đặt TTL 10 s và quan sát hit ratio tụt đều đặn; bật Jitter + coalescing rồi so sánh.',
    see: ['comp-cache', 'concept-cache-ttl', 'concept-cold-start', 'comp-db', 'comp-replica'],
    symptoms: ['Hit ratio của Cache tụt về ~10% đột ngột, lặp lại theo chu kỳ TTL', 'Utilization DB vọt lên gần 100% dù traffic không đổi', 'p99 đọc tăng vọt, một số request timeout', 'Lỗi giảm dần khi cache được nạp lại'],
    mitigations: [
      { name: 'Jitter TTL', how: 'Cộng độ lệch ngẫu nhiên vào TTL để các key không hết hạn cùng lúc.', tradeoff: 'Gần như không tốn gì; thời điểm dữ liệu cũ kém dự đoán hơn.' },
      { name: 'Request coalescing', how: 'Gộp các miss cùng key thành một truy vấn DB duy nhất, các request khác chờ kết quả.', tradeoff: 'Request chờ phải đợi theo truy vấn đầu; thêm logic và nguy cơ treo nếu truy vấn đầu lỗi.' },
      { name: 'Read Replica', how: 'Thêm replica để chia tải đọc khi miss tràn xuống.', tradeoff: 'Tốn chi phí, có replication lag nên có thể đọc dữ liệu cũ.' },
      { name: 'TTL dài hơn', how: 'Chọn TTL 30/60 s để giảm số lần hết hạn.', tradeoff: 'Dữ liệu cũ hơn; cú stampede khi xảy ra vẫn lớn.' }
    ]
  },
  {
    id: 'inc-crash', cat: 'incident',
    title: 'Node crash',
    summary: 'Một component chết bất ngờ; nếu nó là điểm duy nhất trên đường đi thì cả hệ thống ngừng phục vụ.',
    body: `<p>Máy ảo biến mất, process bị OOM-kill, đĩa hỏng hay lỗi phần cứng — trong hệ thống đủ lớn, hỏng hóc là chuyện thường ngày chứ không phải ngoại lệ. Hậu quả phụ thuộc vào kiến trúc: nếu có dư thừa và cơ chế phát hiện, traffic được chuyển sang node khác; nếu không, mọi request đi qua node đó thất bại.</p><p>Trong game: <code>crash</code> làm một component ngẫu nhiên chết tới khi reboot. Load Balancer phát hiện node chết sau ~4 s (health check); trong khoảng đó vẫn gửi vào node chết nên lỗi tăng. Nhiều App <i>không có LB</i> thì chỉ App đầu tiên nhận tải. Với DB, bật <b>failover</b> và có replica để thăng cấp; thử restart nhanh bằng runbook.</p>`,
    pros: [], cons: [],
    real: 'Netflix xây Chaos Monkey (khoảng 2011) để chủ động tắt instance ngẫu nhiên trong production, buộc dịch vụ phải chịu được mất node.',
    tryIt: 'Chạy crash trên monolith, rồi thêm App thứ hai sau LB và chạy lại; so sánh thời gian lỗi.',
    see: ['concept-spof', 'concept-health-checks', 'comp-lb', 'comp-replica', 'concept-chaos', 'comp-k8s', 'comp-s3'],
    symptoms: ['Một component chuyển sang trạng thái chết/đỏ trên sơ đồ', 'Error rate nhảy lên ngay, tỷ lệ tương ứng phần tải mà node đó nhận', 'Trong ~4 s đầu LB vẫn gửi vào node chết', 'Với DB: ghi thất bại hoặc ghi chưa sao chép có thể bị mất'],
    mitigations: [
      { name: 'Dư thừa (N+1)', how: 'Chạy ít nhất hai App sau LB để mất một node vẫn còn năng lực.', tradeoff: 'Tốn chi phí và điện; mỗi node thêm tăng độ phức tạp.' },
      { name: 'Load Balancer health check', how: 'LB loại node chết khỏi vòng chia tải sau ~4 s.', tradeoff: 'Có cửa sổ phát hiện; check quá nhạy gây flapping.' },
      { name: 'Failover DB', how: 'Bật failover tự động hoặc quorum, có replica để thăng cấp làm leader.', tradeoff: 'Async có thể mất ghi chưa sao chép; tự động có nguy cơ split-brain.' },
      { name: 'Restart', how: 'Dùng runbook reboot nhanh node chết.', tradeoff: 'Cần người trực và quan sát; không sửa nguyên nhân gốc.' },
      { name: 'Kubernetes self-healing', how: 'App container hoá (Module Docker) bị crash/OOM-kill được Kubernetes restart tự động ~6 s sau, và pod chết bị loại khỏi định tuyến sau ~1 s nhờ readiness probe.', tradeoff: 'Control plane là SPOF và không tự chữa; độ phức tạp +6, 4 W điện; App không container hoá không được chữa.' },
    ]
  },
  {
    id: 'inc-leak', cat: 'incident',
    title: 'Memory leak',
    summary: 'Bộ nhớ của một App tăng dần không được giải phóng cho đến khi bị OOM-kill.',
    body: `<p>Lỗi giữ tham chiếu (cache không giới hạn, listener không gỡ, connection không đóng) khiến bộ nhớ tăng đều. Ban đầu không thấy gì; khi heap gần đầy, GC chạy liên tục (GC thrash) làm CPU tăng và độ trễ xấu đi, cuối cùng process bị OOM-kill. Sau khi restart mọi thứ lại ổn rồi leak lặp lại — kiểu lỗi chỉ lộ ra ở thời gian chạy dài.</p><p>Trong game: <code>leak</code> làm mem của một App tăng tới OOM. Bạn chỉ thấy đường mem dốc nếu App nằm trong <b>vùng sáng</b> (có giám sát). Cách chữa tạm: <b>Restart</b> hoặc restart xoay vòng từng node sau LB; cách chữa thật là <b>Deploy</b> bản vá. Không giám sát thì bạn chỉ thấy node đột ngột chết.</p>`,
    pros: [], cons: [],
    real: 'Nhiều dịch vụ chạy lâu (JVM, Node, Ruby) phải restart xoay vòng định kỳ như biện pháp tạm cho tới khi vá được leak; đây là thực hành SRE phổ biến.',
    tryIt: 'Đặt Đèn giám sát cạnh App, quan sát đường mem khi leak; restart trước khi chạm OOM.',
    see: ['concept-observability', 'inc-crash', 'concept-blast-radius', 'comp-lantern', 'comp-k8s', 'comp-docker'],
    symptoms: ['Đường mem của một App dốc đều lên', 'p99 xấu dần trước khi chết', 'Node bất ngờ chết (OOM) rồi hết lỗi sau reboot', 'Ngoài vùng sáng: không thấy gì cho tới khi crash'],
    mitigations: [
      { name: 'Giám sát (Đèn giám sát)', how: 'Giữ App trong vùng sáng để thấy mem tăng sớm.', tradeoff: 'Tốn điện và công vận hành; vẫn cần người xem dashboard.' },
      { name: 'Restart', how: 'Restart node trước khi chạm OOM, tốt nhất xoay vòng từng node sau LB.', tradeoff: 'Chỉ trì hoãn; cần dư thừa để không mất dịch vụ lúc restart.' },
      { name: 'Deploy bản vá', how: 'Triển khai bản sửa lỗi leak, từng node một.', tradeoff: 'Deploy có rủi ro bản lỗi (30% trong game).' },
      { name: 'Rollback', how: 'Nếu leak do bản mới, rollback về bản trước.', tradeoff: 'Mất các thay đổi tốt trong bản đó.' },
      { name: 'Kubernetes self-healing', how: 'App container hoá (Module Docker) bị OOM-kill được Kubernetes restart tự động ~6 s sau, không cần kỹ sư.', tradeoff: 'Chỉ che triệu chứng: leak lặp lại; cần độ phức tạp +6 và 4 W điện.' },
    ]
  },
  {
    id: 'inc-ddos', cat: 'incident',
    title: 'DDoS / Botnet',
    summary: 'Hàng loạt client độc hại làm ngập hệ thống bằng request vô giá trị, chiếm công suất của người dùng thật.',
    body: `<p>Kẻ tấn công dùng botnet gửi lượng request khổng lồ (L7: HTTP flood; L3/4: volumetric). Hệ thống không phân biệt được request độc hại và hợp lệ ở lớp thấp nên mọi lớp đều bị chiếm công suất; người dùng thật nhận lỗi hoặc rất chậm. Chặn theo IP đơn lẻ không đủ vì nguồn rất phân tán.</p><p>Trong game: <code>ddos</code> sinh bot vật lý và traffic độc hại (lớp <code>b</code>) tỉ lệ với số bot. <b>WAF</b> (cần module) chặn ~95% request độc hại; <b>Rate limit</b> loại bỏ cả lớp hợp lệ tương ứng (nên thô). Tháp tường lửa và việc giết bot giảm nguồn. Mùa Đông là mùa DDoS.</p>`,
    pros: [], cons: [],
    real: 'Tháng 10/2016 botnet Mirai tấn công nhà cung cấp DNS Dyn khiến nhiều trang lớn khó truy cập trong nhiều giờ.',
    tryIt: 'So sánh % lỗi khi chỉ dùng rate limit và khi bật WAF; để ý người dùng thật bị loại ra sao.',
    see: ['comp-gateway', 'concept-load-shedding', 'comp-turret', 'inc-spike'],
    symptoms: ['Traffic vào Gateway tăng cùng lúc bot xuất hiện trong thế giới', 'Utilization Gateway/App cao dù người dùng thật không tăng', 'Error rate và p99 xấu cho cả người dùng hợp lệ', 'Số request độc hại hiện trên dashboard'],
    mitigations: [
      { name: 'WAF', how: 'Bật module WAF ở Gateway để chặn ~95% request độc hại.', tradeoff: 'Cần module, tốn tài nguyên; có thể chặn nhầm (false positive).' },
      { name: 'Rate limit', how: 'Giới hạn req/s ở Gateway.', tradeoff: 'Loại bỏ cả request hợp lệ; chỉ là lưới an toàn, không chọn lọc.' },
      { name: 'Tháp tường lửa', how: 'Xây tháp để tiêu diệt bot vật lý tiếp cận.', tradeoff: 'Tốn tài nguyên và điện, cần đặt đúng chỗ.' },
      { name: 'Giết bot', how: 'Chủ động tiêu diệt bot bằng tay.', tradeoff: 'Tốn công, rủi ro bị tấn công khi ở ngoài.' }
    ]
  },
  {
    id: 'inc-partition', cat: 'incident',
    title: 'Network partition',
    summary: 'Một đường mạng giữa hai phần của hệ thống bị đứt, buộc phải chọn giữa nhất quán và sẵn sàng.',
    body: `<p>Trong hệ phân tán, mạng có thể mất gói hoặc đứt: hai bên vẫn sống nhưng không thấy nhau. Theo định lý CAP, khi partition xảy ra bạn phải chọn: từ chối ghi để giữ nhất quán (CP), hoặc tiếp tục nhận ghi và chấp nhận phân kỳ (AP). Timeout không cho biết đối tác chết hay chỉ không với tới — đó là gốc của split-brain.</p><p>Trong game: <code>partition</code> cắt một cáp ~25 s. Với <b>sync replication</b>, ghi thất bại khi replica không với tới. Với <b>async</b> + failover tự động, replica có thể bị thăng cấp trong khi primary vẫn sống: hai leader, dữ liệu mất khi nối lại. Chế độ <b>quorum</b> chỉ thăng cấp khi đa số với tới nhau (cần ≥ 3 node).</p>`,
    pros: [], cons: [],
    real: 'Năm 2018 GitHub mất kết nối mạng ~43 giây giữa hai data center khiến MySQL failover sang cụm khác; việc đối soát dữ liệu kéo dài hơn 24 giờ.',
    tryIt: 'Dựng DB + 2 replica: chạy partition với failover tự động async, rồi lặp lại với quorum.',
    see: ['concept-cap', 'concept-split-brain', 'concept-replication', 'comp-replica', 'concept-durability'],
    symptoms: ['Một cáp chuyển trạng thái đứt trên sơ đồ', 'Với sync: ghi thất bại, error rate ghi tăng', 'Replication lag tăng hoặc mất kết nối với replica', 'Sau khi nối lại: cảnh báo xung đột dữ liệu (nếu split-brain)'],
    mitigations: [
      { name: 'Đường dự phòng', how: 'Có cáp/đường dự phòng giữa các component quan trọng.', tradeoff: 'Tốn thêm chi phí và độ phức tạp.' },
      { name: 'Sync replication', how: 'Chỉ ack ghi khi replica đã nhận, không mất dữ liệu.', tradeoff: 'CP: ghi thất bại khi partition; độ trễ ghi cao hơn.' },
      { name: 'Failover quorum', how: 'Chỉ thăng cấp leader khi đa số node với tới nhau.', tradeoff: 'Cần ≥ 3 node; phía thiểu số ngừng nhận ghi.' },
      { name: 'Tắt failover tự động', how: 'Để con người quyết định thăng cấp.', tradeoff: 'Thời gian khôi phục dài hơn.' }
    ]
  },
  {
    id: 'inc-hotkey', cat: 'incident',
    title: 'Hot key / Hot shard',
    summary: 'Phân phối tải lệch: một key hay shard nhận phần lớn request nên nghẽn dù tổng công suất còn dư.',
    body: `<p>Sharding và hash chỉ cân bằng tải khi key phân phối đều. Thực tế key theo luật luỹ thừa: một người nổi tiếng, một sản phẩm hot hay một tenant lớn tạo ra "điểm nóng". Shard chứa key đó đạt ρ ≈ 1 trong khi các shard khác rảnh, nên thêm máy không giúp gì (kết quả tuyến tính chỉ đúng khi tải đều).</p><p>Trong game: <code>hotkey</code> tăng skew của DB và của LB <b>Hash/sticky</b>, khiến một node nhận nhiều hơn. Số <b>shards</b> (1–4) không scale tuyến tính vì có skew. Cách chữa: đặt <b>Cache</b> trước DB để hấp thụ đọc nóng, dùng <b>Least-connections</b> thay hash, và <b>key salting</b> để rải một key ra nhiều shard.</p>`,
    pros: [], cons: [],
    real: 'DynamoDB từng đưa ra khái niệm hot partition và tài liệu AWS khuyên chọn partition key có độ đa dạng cao; consistent hashing được dùng trong Dynamo để rải đều tải.',
    tryIt: 'Đặt 3 App sau LB hash, kích hoạt hotkey; đổi sang least-connections và đo lại.',
    see: ['concept-sharding', 'concept-lb-algos', 'comp-cache', 'comp-db', 'concept-utilization'],
    symptoms: ['Một node/shard có utilization đỏ trong khi node khác thấp', 'p99 xấu dù utilization trung bình ổn', 'Thêm shard/App không cải thiện tương xứng', 'Lỗi tập trung vào một phần người dùng'],
    mitigations: [
      { name: 'Cache', how: 'Cache hấp thụ đọc nóng trước khi chạm DB.', tradeoff: 'Dữ liệu có thể cũ; cần quản lý TTL.' },
      { name: 'Least-connections', how: 'Chia tải theo công suất còn trống thay vì hash.', tradeoff: 'Mất tính sticky nên session/cache cục bộ kém hiệu quả.' },
      { name: 'Key salting', how: 'Thêm hậu tố ngẫu nhiên vào key nóng để rải ra nhiều shard.', tradeoff: 'Đọc phải gom từ nhiều phần; phức tạp hơn.' },
      { name: 'Consistent hashing', how: 'Rải key bằng vòng băm để cân bằng khi thêm/bớt node.', tradeoff: 'Không tự giải quyết một key quá nóng.' }
    ]
  },
  {
    id: 'inc-diskfull', cat: 'incident',
    title: 'Log explosion / Disk full',
    summary: 'Log hoặc dữ liệu tăng vọt làm đầy đĩa; khi đĩa hết chỗ, thao tác ghi thất bại.',
    body: `<p>Một vòng lặp lỗi in log liên tục, bật debug quên tắt, hoặc dữ liệu không có retention sẽ lấp đĩa rất nhanh. Khi đĩa đầy, DB không ghi được WAL, process không tạo được file tạm, và thậm chí không ghi được log để chẩn đoán. Nguy hiểm vì dung lượng là tài nguyên "yên lặng": không có dấu hiệu cho tới khi chạm 100%.</p><p>Trong game: <code>diskfull</code> làm đĩa DB tăng vọt; đĩa đầy → ghi thất bại (đọc vẫn có thể chạy). <b>Retention</b> giảm tốc độ đầy đĩa; <b>Archive</b> dọn đĩa tức thì. Hãy giữ DB trong vùng sáng để thấy % đĩa và cảnh báo trước khi đầy.</p>`,
    pros: [], cons: [],
    real: 'Đầy đĩa do log là nguyên nhân sự cố rất phổ biến; sổ tay SRE của Google khuyến nghị giám sát dung lượng và cảnh báo sớm theo tốc độ tăng, không chỉ theo ngưỡng.',
    tryIt: 'Đặt retention thấp, chạy diskfull, và xem đĩa tăng chậm hơn; rồi bấm Archive.',
    see: ['comp-db', 'concept-observability', 'concept-capacity-cost', 'comp-lantern', 'comp-s3'],
    symptoms: ['Thanh dung lượng đĩa DB tăng dốc bất thường', 'Ghi thất bại khi đĩa đạt 100%', 'Đọc vẫn bình thường (chỉ ghi lỗi)', 'Error rate lớp ghi tăng trong khi lớp đọc ổn'],
    mitigations: [
      { name: 'Retention', how: 'Đặt chính sách giữ dữ liệu ngắn hơn để giảm tốc độ đầy.', tradeoff: 'Mất dữ liệu cũ hữu ích cho điều tra.' },
      { name: 'Archive', how: 'Chuyển dữ liệu cũ sang lưu trữ lạnh để giải phóng đĩa.', tradeoff: 'Mất công/chi phí; dữ liệu archive truy cập chậm.' },
      { name: 'Nối DB tới S3', how: 'DB liên kết với Object Storage offload dữ liệu lạnh nên đĩa đầy chậm hơn 25%, đồng thời có snapshot backup mỗi 30 s.', tradeoff: 'Tốn điện và thêm một thành phần (SPOF cho phần tĩnh nếu S3 còn là origin).' },
      { name: 'Giám sát dung lượng', how: 'Đặt DB trong vùng sáng và cảnh báo trước khi đầy.', tradeoff: 'Tốn điện và công theo dõi.' },
      { name: 'Queue đệm ghi', how: 'Đệm ghi trong lúc xử lý đĩa.', tradeoff: 'Backlog vẫn đầy nếu không giải quyết được gốc rễ.' }
    ]
  },
  {
    id: 'inc-baddeploy', cat: 'incident',
    title: 'Bad deploy',
    summary: 'Bản phát hành mới chứa lỗi khiến một phần hoặc toàn bộ request thất bại.',
    body: `<p>Phần lớn sự cố production bắt nguồn từ thay đổi. Một bản deploy lỗi nếu phát hành đồng loạt sẽ ảnh hưởng toàn bộ người dùng (blast radius lớn); nếu phát hành từng bước (canary) và đo, bạn phát hiện sớm khi mới ảnh hưởng một phần nhỏ. Nếu không giám sát, lỗi âm thầm kéo dài cho tới khi người dùng phàn nàn.</p><p>Trong game: mỗi <b>Deploy</b> có rủi ro bản lỗi (30%, Backend Dev 12%, App container hoá 12%) → bản lỗi làm hỏng khoảng 40% request nó phục vụ, và bạn không thấy nếu node ngoài vùng sáng. Phần request chạm bản lỗi phụ thuộc <b>chiến lược deploy</b> chọn ở Cấu hình của App: <i>deploy thẳng</i> là 100% ngay, <i>canary</i> chỉ 10% trong cửa sổ quan sát (rồi tự lên 100% nếu không ai rollback), <i>blue/green</i> là 100% nhưng rollback tức thì không cần reboot. Nếu lỗi, bấm <b>Rollback</b>: rollback nhanh thường tốt hơn là tìm lỗi trong lúc đang cháy.</p>`,
    pros: [], cons: [],
    real: 'Knight Capital (1/8/2012) mất khoảng 440 triệu USD trong ~45 phút sau khi deploy không đồng bộ: một server vẫn chạy code cũ kích hoạt logic giao dịch lỗi.',
    tryIt: 'Có 3 App sau LB; deploy chỉ một node, xem error rate, rồi rollback nếu lỗi.',
    see: ['concept-deploy-strategies', 'concept-blast-radius', 'concept-observability', 'comp-app', 'concept-postmortem', 'comp-docker', 'comp-k8s', 'concept-containers'],
    symptoms: ['Error rate tăng ngay sau lần deploy', 'Chỉ một phần request lỗi (~40% của phần traffic chạy bản mới)', 'Canary: chỉ phần traffic canary lỗi cho tới khi cửa sổ quan sát kết thúc', 'Node ngoài vùng sáng: không có tín hiệu nào', 'p99 và lỗi cải thiện ngay sau rollback'],
    mitigations: [
      { name: 'Canary', how: 'Chọn Canary ở Cấu hình App: bản mới chỉ nhận 10% request của node trong 24 s; inspector (khi được giám sát) hiện "canary lỗi X%". Rollback trong cửa sổ không cần reboot.', tradeoff: 'Không ai rollback thì tự lên 100% và lỗi lan toàn bộ; tốn 1 linh kiện mỗi lần, thêm chút điện và độ phức tạp.' },
      { name: 'Blue/green', how: 'Bản cũ chạy song song 18 s: deploy không downtime và rollback tức thì (chuyển traffic lại, không reboot).', tradeoff: 'Bản mới nhận 100% traffic ngay nên blast radius vẫn lớn; tốn 2 linh kiện + 1 đồng và gấp đôi điện trong cửa sổ.' },
      { name: 'Deploy từng node', how: 'Với ≥ 2 App sau LB, deploy một node trước, quan sát rồi mới tiếp tục.', tradeoff: 'Phát hành chậm hơn; cần ≥ 2 node và đo đạc tốt.' },
      { name: 'Giám sát', how: 'Giữ App trong vùng sáng để thấy error rate sau deploy.', tradeoff: 'Tốn điện và công theo dõi.' },
      { name: 'Rollback', how: 'Quay về bản trước ngay khi thấy lỗi.', tradeoff: 'Có thể mất tính năng/sửa lỗi; cần artifact bản cũ.' },
      { name: 'Container hoá (Module Docker)', how: 'Image bất biến loại bỏ lệch môi trường "works on my machine": xác suất bản lỗi giảm từ 30% xuống 12% (Backend Dev 12% → 5%).', tradeoff: '-4% công suất, độ phức tạp +1; vẫn không bắt được lỗi logic.' },
      { name: 'Kubernetes rolling update', how: 'Với App container hoá nằm sau Kubernetes, rolling update thay mọi chiến lược đã chọn: deploy chỉ ~1 s downtime và readiness probe thất bại sẽ tự rollback bản lỗi sau ~10 s.', tradeoff: 'Độ phức tạp +6, 4 W điện; control plane là SPOF.' },
      { name: 'Restart', how: 'Khởi động lại để loại trừ lỗi trạng thái.', tradeoff: 'Không sửa lỗi nếu nguyên nhân là code.' }
    ]
  },
  {
    id: 'inc-outage', cat: 'incident',
    title: 'Power / AZ outage',
    summary: 'Mất nguồn hoặc cả vùng hạ tầng, kéo theo mọi component đặt ở đó cùng sập.',
    body: `<p>Nhiều component có vẻ độc lập nhưng thực chất chia sẻ một nguyên nhân chung (nguồn điện, rack, Availability Zone, một nhà cung cấp). Khi nguyên nhân chung hỏng, mọi bản sao trong cùng "fault domain" mất đồng thời — dư thừa trong cùng một vùng không giúp được gì. Phân tán qua nhiều fault domain là cách giảm correlated failure.</p><p>Trong game: <code>outage</code> làm một máy phát sập 30 s; component được cấp điện bởi máy đó tắt. Máy phát cấp điện trong bán kính ~8 ô, và có thể <b>chồng lấn</b> để dự phòng. Hãy phân tán component quan trọng và đặt hai máy phát phủ lên chúng; nhớ cả nhiên liệu cũng là chi phí.</p>`,
    pros: [], cons: [],
    real: 'Ngày 28/2/2017 sự cố dịch vụ S3 ở vùng us-east-1 làm ảnh hưởng rất nhiều dịch vụ phụ thuộc vào vùng đó; AWS khuyến nghị thiết kế đa AZ/đa vùng.',
    tryIt: 'Đặt hai máy phát chồng lấn phủ Gateway và App; chạy outage và so sánh với một máy phát.',
    see: ['concept-spof', 'comp-generator', 'concept-blast-radius', 'concept-capacity-cost'],
    symptoms: ['Một nhóm component cùng mất điện và tắt', 'Đèn và vùng sáng quanh máy phát biến mất', 'Error rate nhảy lên theo phần tải của các component đó', 'Mất metrics của khu vực đó'],
    mitigations: [
      { name: 'Hai máy phát chồng lấn', how: 'Đặt hai máy phát phủ lên cùng các component quan trọng.', tradeoff: 'Tốn thêm nhiên liệu/chi phí và chỗ đặt.' },
      { name: 'Phân tán component', how: 'Không đặt tất cả bản sao trong cùng khu vực/máy phát.', tradeoff: 'Thêm độ trễ và độ phức tạp vận hành.' },
      { name: 'Dư thừa (N+1)', how: 'Giữ bản sao ở fault domain khác để tiếp quản.', tradeoff: 'Chi phí gấp đôi cho tài nguyên nhàn rỗi.' },
      { name: 'Nhiên liệu dự trữ', how: 'Luôn giữ nhiên liệu đầy để máy phát chạy lâu.', tradeoff: 'Tốn công tìm và mang than.' }
    ]
  },
  {
    id: 'inc-analytics', cat: 'incident',
    title: 'Heavy analytics query (Noisy neighbor)',
    summary: 'Một truy vấn báo cáo nặng chiếm tài nguyên DB, làm chậm các truy vấn giao dịch của người dùng.',
    body: `<p>Báo cáo quét bảng lớn tiêu thụ CPU, I/O và buffer cache; trên cùng một DB, workload OLTP (nhanh, nhiều) và OLAP (nặng, ít) cạnh tranh tài nguyên. Truy vấn của người dùng xếp hàng sau truy vấn nặng, p99 tăng vọt. Đây là dạng "noisy neighbor": một tenant/workload làm hại những workload khác.</p><p>Trong game: <code>analytics</code> tăng đột biến tải DB — trên <b>replica</b> nếu có, nếu không thì trên primary. Nhờ cô lập workload bằng <b>Read Replica</b>, truy vấn nặng không chạm ghi và đọc quan trọng trên primary. Nhưng replica có độ trễ sao chép tăng khi primary quá tải, nên báo cáo có thể đọc dữ liệu hơi cũ; đổi lại, người dùng giao dịch không bị ảnh hưởng.</p>`,
    pros: [], cons: [],
    real: 'Việc tách báo cáo/phân tích sang read replica hoặc data warehouse là thực hành phổ biến, và nguyên tắc cô lập workload được nêu trong nhiều tài liệu vận hành DB.',
    tryIt: 'Chạy analytics với một DB đơn, rồi thêm Read Replica và chạy lại; so sánh p99 ghi.',
    see: ['comp-replica', 'concept-replication', 'concept-utilization', 'comp-db'],
    symptoms: ['Utilization DB tăng vọt đột ngột dù traffic người dùng không đổi', 'p99 của cả đọc và ghi xấu đi', 'Hàng đợi/backlog ghi tăng', 'Replica báo lag tăng'],
    mitigations: [
      { name: 'Read Replica', how: 'Chạy báo cáo trên replica để không đè lên primary.', tradeoff: 'Tốn chi phí; dữ liệu replica hơi cũ.' },
      { name: 'Queue cho ghi', how: 'Đệm ghi để hấp thụ lúc DB chậm.', tradeoff: 'Ghi eventual, backlog có giới hạn.' },
      { name: 'Cache', how: 'Cache các đọc phổ biến để giảm tải DB.', tradeoff: 'Dữ liệu có thể cũ.' },
      { name: 'Nâng tier DB', how: 'Nâng công suất DB cho đủ dư.', tradeoff: 'Tốn chi phí, không giải quyết cạnh tranh tài nguyên về bản chất.' }
    ]
  },
  {
    id: 'inc-dataloss', cat: 'incident',
    title: 'Xóa nhầm dữ liệu / DROP TABLE',
    summary: 'Một thao tác nhầm hoặc migration lỗi xoá hay ghi đè dữ liệu; lỗi được sao chép sang mọi replica ngay lập tức.',
    body: `<p>Không phải mọi mất dữ liệu đều do phần cứng. Một lệnh <code>DROP TABLE</code> chạy nhầm môi trường, một migration thiếu điều kiện <code>WHERE</code> hay một bug ghi sai đều là thay đổi "hợp lệ" với DB, và replication sao chép nó sang mọi bản sao trong tích tắc. Failover và replica vô ích ở đây vì chúng chỉ trả lời câu hỏi "node chết thì sao". Thứ cứu được là một điểm trong quá khứ: backup/snapshot.</p><p>Trong game: <code>dataloss</code> (từ ngày 6) đánh dấu một DB là hỏng: ~40% request đọc và ghi thất bại, trên cả DB lẫn replica, và failover sang replica không chữa được. Nếu Backup bật và đã có snapshot, đứng gần DB bấm <b>Khôi phục từ backup</b>: DB reboot ~12 s (DBA nhanh gấp đôi) và bạn mất các ghi sau snapshot cuối. Không có snapshot thì sau ~60 s cả đội phải dựng lại dữ liệu từ đầu và mất mọi ghi chưa được bảo vệ. Snapshot tạm dừng khi dữ liệu hỏng để không ghi đè điểm khôi phục sạch.</p>`,
    pros: [], cons: [],
    real: 'Ngày 31/1/2017 một kỹ sư GitLab.com xoá nhầm dữ liệu của DB primary; trong các cơ chế backup/replication chỉ còn một snapshot thủ công cũ khoảng 6 giờ dùng được nên GitLab mất khoảng 6 giờ dữ liệu, và công bố công khai bản postmortem.',
    tryIt: 'Bật Backup hằng giờ ở DB rồi gây dataloss trong Chaos Lab và bấm Khôi phục; sau đó tắt Backup (chỉ còn replica) và chạy lại để thấy khác biệt.',
    see: ['concept-backup', 'concept-durability', 'concept-replication', 'comp-replica', 'comp-db'],
    symptoms: ['Lỗi đọc và ghi cùng tăng ~40% dù DB không quá tải', 'Thẻ DB báo "DỮ LIỆU HỎNG"', 'Failover sang replica không làm lỗi giảm', 'Nếu DB ngoài vùng sáng: chỉ có khách hàng phàn nàn mới báo cho bạn'],
    mitigations: [
      { name: 'Backup định kỳ (snapshot)', how: 'Bật Backup hằng giờ hoặc hằng ngày ở cấu hình DB rồi khôi phục từ snapshot cuối.', tradeoff: 'Tốn đĩa và IO mỗi snapshot; mất các ghi sau snapshot cuối (RPO = tuổi snapshot).' },
      { name: 'Rút ngắn chu kỳ backup', how: 'Dùng Hằng giờ thay vì Hằng ngày để RPO nhỏ hơn.', tradeoff: 'Tốn đĩa và IO nhiều hơn; vẫn không bằng sao lưu log liên tục.' },
      { name: 'Giám sát DB', how: 'Giữ DB trong vùng sáng để thấy cảnh báo dữ liệu hỏng và khôi phục sớm, ít ghi bị mất hơn.', tradeoff: 'Tốn điện và công theo dõi.' },
      { name: 'Giới hạn thay đổi nguy hiểm', how: 'Review migration, tách quyền ghi production và thử trên staging trước.', tradeoff: 'Ship chậm hơn và vẫn không loại hết lỗi con người.' }
    ]
  },

  // ───────────────────────── CONCEPTS ─────────────────────────
  {
    id: 'concept-spof', cat: 'concept',
    title: 'Single Point of Failure (SPOF) & dư thừa N+1',
    summary: 'SPOF là thành phần mà nếu hỏng thì cả hệ thống ngừng; cách chữa là dư thừa.',
    body: `<p>SPOF là bất kỳ thành phần nào không có bản thay thế mà đường đi bắt buộc phải qua. Độ khả dụng của chuỗi nối tiếp là <i>tích</i> độ khả dụng từng mắt xích (ba mắt xích 99.9% cho ~99.7%), nên thêm component nối tiếp luôn làm giảm tổng. Dư thừa song song làm tăng: N+1 nghĩa là có thêm một bản sao ngoài số cần để đáp ứng tải.</p><p>Chú ý các SPOF "ẩn": Load Balancer, DNS, máy phát điện, người trực duy nhất. Dư thừa chỉ hữu dụng nếu có cơ chế phát hiện và chuyển hướng, và các bản sao không chia sẻ nguyên nhân chung. Trong game: monolith <code>Gateway → App → DB</code> là chuỗi toàn SPOF; thêm App sau LB, replica cho DB và hai máy phát chồng lấn.</p>`,
    pros: ['Hệ thống chịu được mất một node mà không ngừng', 'Cho phép bảo trì/deploy mà không downtime', 'Giảm rủi ro ở các thành phần quan trọng'],
    cons: ['Tốn chi phí và điện cho tài nguyên nhàn rỗi', 'Thêm độ phức tạp (đồng bộ, failover)', 'LB/failover mới có thể thành SPOF mới'],
    real: 'Sự cố S3 us-east-1 năm 2017 cho thấy một dịch vụ nền tảng thành SPOF cho rất nhiều phụ thuộc; ngành hàng không dùng dư thừa nhiều lớp (N+1) cho hệ thống quan trọng.',
    tryIt: 'Vẽ monolith, chạy crash trên từng node; liệt kê thành phần nào làm cả hệ thống tắt.',
    see: ['inc-crash', 'inc-outage', 'comp-lb', 'comp-generator', 'concept-capacity-cost', 'comp-s3', 'comp-k8s', 'concept-orchestration'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-backpressure', cat: 'concept',
    title: 'Backpressure & bounded buffer',
    summary: 'Cơ chế để phía chậm báo cho phía nhanh giảm tốc, thay vì để hàng đợi phình vô hạn.',
    body: `<p>Khi producer nhanh hơn consumer, hàng đợi sẽ lớn dần. Hàng đợi không giới hạn chỉ chuyển lỗi từ "từ chối" sang "độ trễ vô hạn" rồi hết bộ nhớ (Little's Law: số phần tử = tốc độ đến × thời gian chờ). Backpressure là tín hiệu ngược: từ chối, chặn, hoặc yêu cầu producer chậm lại để hệ thống ổn định.</p><p>Trong game: <b>Message Queue</b> nhận ghi nhanh (ack sớm) và xả dần vào DB theo công suất DB còn trống; khi backlog đầy, queue <i>từ chối</i> ghi — đó là bounded buffer. Bạn đo <b>lag</b> để biết consumer có theo kịp không. Backlog tăng đều nghĩa là công suất xả &lt; tốc độ vào, và queue chỉ mua thời gian.</p>`,
    pros: ['Hấp thụ đỉnh ngắn, san phẳng tải lên DB', 'Tách producer khỏi consumer (decoupling)', 'Lỗi rõ ràng và sớm khi quá tải'],
    cons: ['Ghi trở thành eventual: có độ trễ trước khi thấy', 'Bounded buffer đầy sẽ từ chối công việc', 'Thêm component để vận hành và đo lag'],
    real: 'Reactive Streams và TCP flow control (cửa sổ nhận) là các cơ chế backpressure phổ biến; Kafka cho phép consumer tự kéo (pull) theo tốc độ của mình.',
    tryIt: 'Thêm Queue trước DB, kích hoạt spike; theo dõi lag tăng rồi giảm khi spike qua.',
    see: ['comp-queue', 'inc-spike', 'concept-load-shedding', 'concept-utilization'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-load-shedding', cat: 'concept',
    title: 'Load shedding & Rate limiting',
    summary: 'Chủ động từ chối một phần request để phần còn lại vẫn được phục vụ tốt.',
    body: `<p>Quá tải không xử lý sẽ khiến mọi request đều chậm rồi cùng timeout (goodput giảm về 0). <b>Rate limiting</b> áp hạn mức theo client/khoá để công bằng; <b>load shedding</b> bỏ công việc khi hệ thống bão hoà, ưu tiên theo mức quan trọng. Thuật toán token bucket cho phép burst ngắn trong khi giữ tốc độ trung bình; leaky bucket làm mượt đầu ra.</p><p>Công bằng quan trọng: giới hạn toàn cục dễ để một client lớn chiếm hạn mức. Trả 429/503 kèm <code>Retry-After</code> giúp client lùi lại, và client phải backoff để tránh retry storm. Trong game: <b>Rate limit</b> ở Gateway (req/s) loại bỏ <i>cả lớp hợp lệ</i> tương ứng — thô nhưng cứu hệ thống; WAF thì chọn lọc request độc hại.</p>`,
    pros: ['Giữ hệ thống ở vùng ổn định, duy trì goodput', 'Bảo vệ khỏi client lỗi/độc hại', 'Phản hồi thất bại nhanh thay vì timeout chậm'],
    cons: ['Người dùng hợp lệ bị từ chối', 'Khó chọn ngưỡng đúng', 'Cần cơ chế công bằng/ưu tiên để không bất công'],
    real: 'Stripe công bố cách dùng token bucket rate limiter và load shedder nhiều tầng; Google SRE book có chương về xử lý quá tải và graceful degradation.',
    tryIt: 'Đặt rate limit thấp hơn nhu cầu đỉnh trong spike và so sánh error rate với khi không đặt.',
    see: ['inc-spike', 'inc-ddos', 'comp-gateway', 'concept-retry-storm', 'concept-graceful-degradation'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-retry-storm', cat: 'concept',
    title: 'Retry storm & backoff + jitter',
    summary: 'Retry thiếu kiểm soát khuếch đại tải đúng lúc dịch vụ đang yếu, biến lỗi nhỏ thành sập.',
    body: `<p>Nếu mỗi tầng retry 3 lần thì chuỗi 3 tầng có thể khuếch đại tải tới 3³ = 27 lần ở tầng đáy. Khi dịch vụ chậm, retry thêm tải làm nó chậm hơn nữa (metastable failure): ngay cả khi nguyên nhân ban đầu hết, hệ thống vẫn kẹt trong vòng xoáy. Cách phòng: <b>exponential backoff</b> tăng dần giãn cách, <b>jitter</b> làm lệch thời điểm để client không đồng bộ, <b>retry budget</b> giới hạn tỉ lệ retry, và chỉ retry thao tác <b>idempotent</b>.</p><p>Trong game: người dùng retry khi lỗi nên traffic thực lớn hơn nhu cầu. App có cấu hình <b>retries</b> 0–3, <b>backoff+jitter</b>, và <b>circuit breaker</b>. Retries cao mà không backoff làm spike nặng hơn.</p>`,
    pros: ['Retry có kiểm soát vượt qua lỗi thoáng qua', 'Backoff + jitter làm mượt tải', 'Retry budget bảo vệ dịch vụ phía dưới'],
    cons: ['Retry thiếu kiểm soát khuếch đại sự cố', 'Cần thao tác idempotent để tránh trùng lặp', 'Tăng độ trễ đuôi khi thử lại nhiều'],
    real: 'AWS Architecture Blog bài "Exponential Backoff and Jitter" chỉ ra jitter làm giảm đáng kể tranh chấp; Google SRE book khuyến nghị retry budget và giới hạn số lần thử.',
    tryIt: 'Đặt retries = 3 không backoff khi spike, rồi bật backoff+jitter và so sánh traffic thực.',
    see: ['inc-spike', 'concept-circuit-breaker', 'concept-load-shedding', 'comp-app'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-circuit-breaker', cat: 'concept',
    title: 'Circuit breaker',
    summary: 'Ngắt gọi tới dependency đang lỗi để fail fast và cho nó cơ hội hồi phục.',
    body: `<p>Circuit breaker có ba trạng thái: <b>closed</b> (gọi bình thường, đếm lỗi), <b>open</b> (vượt ngưỡng lỗi → từ chối ngay không gọi, fail fast), <b>half-open</b> (sau một khoảng, cho vài request thăm dò; thành công thì đóng lại, thất bại thì mở lại). Lợi ích: tránh chờ timeout (giữ thread/connection), ngăn lỗi lan truyền (cascading failure), và giảm tải cho dịch vụ đang hồi phục.</p><p>Trong game: App có <b>circuit breaker</b> mở khi &gt;50% lỗi từ downstream; khi mở nó fail fast và thăm dò 5%. Cần kết hợp với fallback (graceful degradation) và retry có backoff để request bị từ chối vẫn trả được gì đó; ngưỡng quá nhạy sẽ gây flapping.</p>`,
    pros: ['Fail fast, không treo tài nguyên chờ timeout', 'Chặn lỗi lan truyền xuống các tầng trên', 'Giảm tải cho dịch vụ đang hồi phục'],
    cons: ['Có thể ngắt nhầm khi lỗi thoáng qua', 'Cần chọn ngưỡng và thời gian thăm dò', 'Phải có fallback, nếu không người dùng vẫn lỗi'],
    real: 'Netflix Hystrix phổ biến hoá circuit breaker trong microservice; Martin Fowler mô tả pattern này trong bài "CircuitBreaker".',
    tryIt: 'Bật circuit breaker ở App, kill DB và xem breaker mở; quan sát thăm dò 5% khi DB hồi phục.',
    see: ['concept-retry-storm', 'concept-graceful-degradation', 'comp-app', 'inc-crash'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-blast-radius', cat: 'concept',
    title: 'Blast radius: canary, blue-green, rolling & feature flags',
    summary: 'Thu nhỏ phạm vi ảnh hưởng của thay đổi để lỗi không làm hỏng toàn bộ người dùng.',
    body: `<p>Blast radius là phần hệ thống/người dùng bị ảnh hưởng khi một thay đổi hỏng. Chiến lược triển khai điều khiển nó: <b>rolling</b> cập nhật từng node; <b>canary</b> cho một phần nhỏ traffic dùng bản mới và đo (error rate, p99) trước khi mở rộng; <b>blue-green</b> chạy hai môi trường song song và chuyển traffic, rollback bằng cách chuyển lại; <b>feature flag</b> tách deploy khỏi release và tắt tính năng tức thì. Điều kiện chung: giám sát tốt và rollback nhanh.</p><p>Trong game: chọn <b>chiến lược deploy</b> ở Cấu hình của App (xem mục Chiến lược deploy). Có nhiều App sau LB nghĩa là blast radius mỗi lần deploy chỉ là một phần; luôn kiểm tra trong vùng sáng rồi <b>Rollback</b> nếu lỗi.</p>`,
    pros: ['Lỗi chỉ ảnh hưởng một phần nhỏ người dùng', 'Rollback nhanh khi phát hiện sớm', 'Cho phép phát hành thường xuyên và an toàn'],
    cons: ['Cần nhiều hạ tầng (blue-green gấp đôi)', 'Phải hỗ trợ hai phiên bản chạy song song', 'Phụ thuộc giám sát để phát hiện lỗi'],
    real: 'Knight Capital 2012 bị thiệt hại lớn do triển khai không đồng đều trên 8 server; ngược lại Google và Netflix dùng canary analysis tự động trước khi mở rộng.',
    tryIt: 'Deploy trên một trong ba App, quan sát error rate, rồi rollback hoặc tiếp tục.',
    see: ['concept-deploy-strategies', 'inc-baddeploy', 'concept-observability', 'comp-lb', 'comp-app'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-health-checks', cat: 'concept',
    title: 'Health checks: liveness vs readiness',
    summary: 'Cách LB/orchestrator biết node nào còn dùng được; độ nhạy quyết định thời gian phát hiện và flapping.',
    body: `<p><b>Liveness</b> trả lời "process còn sống không?" (nếu không, restart). <b>Readiness</b> trả lời "đã sẵn sàng nhận traffic chưa?" (cache nóng, DB nối được); node chưa ready bị loại khỏi vòng chia tải mà không bị restart. Hai thứ khác nhau: liveness kiểm tra quá sâu (gọi DB) có thể khiến cả fleet bị restart khi DB chậm.</p><p>Chu kỳ và số lần fail liên tiếp quyết định <i>detection delay</i>; quá nhạy thì <b>flapping</b> (vào/ra liên tục). Trong game: LB phát hiện node chết sau ~4 s — trong lúc đó vẫn gửi vào node chết và gây lỗi. Check nên phản ánh khả năng phục vụ thật, nhưng không phụ thuộc dependency chia sẻ.</p>`,
    pros: ['Loại node hỏng khỏi vòng chia tải tự động', 'Tách "sống" khỏi "sẵn sàng" giúp rollout an toàn', 'Cho phép tự phục hồi'],
    cons: ['Có độ trễ phát hiện nên vẫn có lỗi', 'Check quá nhạy gây flapping', 'Check quá sâu có thể gây lỗi dây chuyền'],
    real: 'Kubernetes tách liveness, readiness và startup probe; tài liệu của AWS ELB cũng nêu ngưỡng healthy/unhealthy và chu kỳ kiểm tra.',
    tryIt: 'Kill một App sau LB và đếm số giây lỗi tới khi LB loại node (~4 s).',
    see: ['comp-lb', 'inc-crash', 'concept-cold-start', 'concept-observability'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-graceful-degradation', cat: 'concept',
    title: 'Graceful degradation',
    summary: 'Khi một phần hỏng, vẫn phục vụ phiên bản giảm chức năng thay vì lỗi toàn bộ.',
    body: `<p>Thay vì "tất cả hoặc không", thiết kế các mức dịch vụ: trả dữ liệu cũ từ cache khi DB lỗi (<i>stale-while-revalidate</i>, <i>stale-if-error</i>), tắt tính năng không thiết yếu (gợi ý, thống kê), trả kết quả mặc định, hoặc chuyển sang chế độ chỉ đọc. Cần xác định trước chức năng cốt lõi, và kiểm thử đường fallback thường xuyên vì chúng ít được chạy.</p><p>Trong game: Cache phục vụ đọc ngay cả khi DB chậm nếu hit tốt; CDN phục vụ lớp tĩnh khi origin yếu; <b>Rate limit</b> hy sinh một phần để giữ cốt lõi. Kết hợp với circuit breaker: breaker mở thì fallback thay vì báo lỗi. Đánh đổi: dữ liệu có thể cũ.</p>`,
    pros: ['Người dùng vẫn dùng được chức năng cốt lõi', 'Giảm tác động của sự cố', 'Bảo vệ dependency đang yếu'],
    cons: ['Dữ liệu có thể cũ hoặc thiếu', 'Tăng độ phức tạp, nhiều đường code', 'Fallback ít được kiểm thử có thể tự hỏng'],
    real: 'Netflix hiển thị danh sách mặc định khi dịch vụ gợi ý lỗi; Google SRE book nói về degraded mode và ưu tiên request quan trọng khi quá tải.',
    tryIt: 'Dựng CDN + Cache, kill DB và xem phần nào của traffic vẫn thành công.',
    see: ['concept-circuit-breaker', 'concept-load-shedding', 'comp-cache', 'comp-cdn'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-cold-start', cat: 'concept',
    title: 'Cold start & warm-up',
    summary: 'Component vừa khởi động hoạt động kém cho đến khi cache, pool và JIT được làm ấm.',
    body: `<p>Instance mới chưa có cache nóng, connection pool rỗng, JIT chưa tối ưu, và các lớp chưa nạp. Nếu bạn cho nhận đầy tải ngay, nó chậm và có thể sập lại (warm-up crash loop). Cách giải: <b>warm-up</b> tăng traffic dần (slow start), <b>cache priming</b> nạp trước các key phổ biến, và readiness check chỉ báo ready khi đủ ấm.</p><p>Trong game: <b>Cache</b> khởi động nguội mất ~20 s mới ấm; <b>CDN</b> hit ~92% chỉ sau khi ấm; autoscaler thêm instance cần 15 s khởi động; scale-up App cần reboot ~10 s. Hậu quả: sau crash hay restart, hit ratio thấp làm DB nhận toàn bộ tải đọc, dễ biến thành stampede.</p>`,
    pros: ['Warm-up giúp instance mới không bị quá tải', 'Cache priming giảm miss lúc đầu', 'Slow start bảo vệ DB'],
    cons: ['Tăng thời gian để scale/khôi phục', 'Cần logic và dữ liệu cho priming', 'Trong lúc ấm, năng lực thực tế thấp hơn danh nghĩa'],
    real: 'AWS ELB và nhiều LB có "slow start" tăng dần traffic cho target mới; JVM cần thời gian JIT warm-up nên nhiều hệ thống chạy request giả trước khi nhận traffic.',
    tryIt: 'Restart Cache khi có traffic và xem hit ratio tăng dần trong ~20 s cùng tải trên DB.',
    see: ['inc-stampede', 'comp-cache', 'concept-autoscaling', 'concept-health-checks'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-split-brain', cat: 'concept',
    title: 'Split-brain, quorum & fencing',
    summary: 'Hai node cùng tin mình là leader sau partition, gây ghi xung đột và mất dữ liệu.',
    body: `<p>Khi leader không liên lạc được, bạn không phân biệt được "nó chết" hay "mạng đứt". Nếu thăng cấp replica mà leader cũ vẫn nhận ghi, ta có hai leader (split-brain) và dữ liệu phân kỳ. Giải pháp: <b>quorum</b> (cần đa số N/2+1 đồng ý mới được làm leader nên chỉ một phía có thể thắng), <b>leader election</b> bằng đồng thuận (Raft/Paxos), và <b>fencing</b> (token tăng dần hoặc STONITH để leader cũ không thể ghi).</p><p>Trong game: failover tự động + async + partition ⇒ hai leader, khi nối lại thì xung đột = mất dữ liệu. Chế độ <b>quorum</b> chỉ thăng cấp khi đa số với tới nhau, cần ≥ 3 node (primary + 2 replica). Với 2 node, đa số không tồn tại.</p>`,
    pros: ['Quorum đảm bảo tối đa một leader', 'Fencing chặn leader cũ ghi', 'Tránh mất dữ liệu do xung đột'],
    cons: ['Cần ≥ 3 node, tốn chi phí', 'Phía thiểu số ngừng phục vụ ghi', 'Độ trễ ghi cao hơn do đồng thuận'],
    real: 'Sự cố GitHub 2018 là ví dụ failover sau partition dẫn đến hai cụm MySQL có ghi khác nhau; Raft và ZooKeeper dùng quorum cho leader election.',
    tryIt: 'Dựng DB + 2 replica, partition với failover auto async và rồi quorum; so sánh kết quả.',
    see: ['inc-partition', 'concept-cap', 'concept-replication', 'concept-durability'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-durability', cat: 'concept',
    title: 'Durability: RPO, RTO & backup vs replica',
    summary: 'Replication không phải backup: bản sao cũng sao chép luôn lỗi và thao tác xoá nhầm.',
    body: `<p><b>RPO</b> (Recovery Point Objective) là lượng dữ liệu tối đa chấp nhận mất, tính theo thời gian; <b>RTO</b> (Recovery Time Objective) là thời gian tối đa để khôi phục. Replica trả lời "node chết thì sao" (RTO thấp), còn backup trả lời "dữ liệu bị xoá/hỏng thì sao" (point-in-time). <code>DROP TABLE</code> nhầm hay bug ghi sai được replicate sang mọi bản sao ngay lập tức, nên replica không thay thế backup đã kiểm thử khôi phục.</p><p>Trong game: ghi <b>async</b> chưa sao chép sẽ bị <b>mất</b> khi leader chết (RPO &gt; 0); <b>sync</b> cho RPO ≈ 0 nhưng ghi thất bại nếu replica không với tới (CP). <b>Archive</b>/retention ảnh hưởng dung lượng và lịch sử. Hãy cân đối RPO/RTO với chi phí.</p><p>Nối DB tới <b>Object Storage (S3)</b> để có backup thật: snapshot mỗi 30 s, nên RPO khi mất đĩa là khoảng thời gian kể từ snapshot cuối (inspector hiện số giây này); không có backup, mất đĩa DB là mất mọi thứ ghi từ đầu. Replica không cứu được tình huống đó nếu lỗi đã được sao chép.</p>`,
    pros: ['RPO/RTO cho mục tiêu khôi phục rõ ràng', 'Backup bảo vệ trước lỗi logic và xoá nhầm', 'Sync replication tránh mất ghi'],
    cons: ['Sync làm tăng độ trễ và giảm khả dụng', 'Backup chưa kiểm thử khôi phục là vô giá trị', 'Chi phí lưu trữ và vận hành'],
    real: 'Sự cố GitLab.com ngày 31/1/2017 xoá nhầm dữ liệu primary và nhiều cơ chế backup không dùng được, được ghi lại công khai trong postmortem.',
    tryIt: 'Chạy crash trên DB với async và sync; so sánh lượng ghi bị mất và lỗi ghi.',
    see: ['concept-backup', 'concept-replication', 'concept-cap', 'comp-replica', 'inc-diskfull', 'inc-dataloss', 'comp-s3'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-backup', cat: 'concept',
    title: 'Backup, RPO & RTO (replica không phải backup)',
    summary: 'Backup là điểm quay về trong quá khứ; replica chỉ là bản sao của hiện tại nên sao chép cả lỗi.',
    body: `<p>Backup là bản sao dữ liệu <i>tại một thời điểm</i>, được giữ riêng khỏi dữ liệu sống. <b>RPO</b> thực tế chính là tuổi của snapshot cuối (backup hằng giờ thì mất tới ~1 giờ ghi); <b>RTO</b> là thời gian dựng lại dữ liệu từ đó (nạp, replay log, kiểm tra). Replica thì ngược lại: nó luôn cố giống primary <i>ngay bây giờ</i>, nên thảm hoạ logic (xoá nhầm, migration lỗi, bug ghi sai, ransomware) được sao chép sang nó tức thì. Replica chống mất node, backup chống mất dữ liệu: hai việc khác nhau.</p><p>Trong game: cấu hình DB có Backup <b>Tắt</b>, <b>Hằng giờ</b> (snapshot mỗi 30 s) và <b>Hằng ngày</b> (mỗi 150 s, một ngày game). Mỗi snapshot chạy vài giây (tốn IO, DB chậm đi) rồi chiếm một phần đĩa; Retention giảm phần đĩa này. Thẻ DB hiện "Backup gần nhất" và số bản ghi chưa được bảo vệ. Khi <code>dataloss</code> xảy ra, nút <b>Khôi phục từ backup</b> đưa DB về snapshot cuối (reboot ~12 s). Tắt Backup xoá mọi snapshot nằm trên node DB.</p><p>Nối DB tới <b>Object Storage (S3)</b> là một nguồn backup thứ hai: snapshot mỗi 30 s đẩy ra ngoài node nên không mất khi tắt Backup hay khi đĩa DB hỏng, và cũng dùng được để khôi phục. Hai nguồn cùng tồn tại thì điểm khôi phục là snapshot mới nhất.</p><p>Hai quy tắc thực tế: backup chưa từng thử khôi phục thì chưa phải là backup, và nó phải nằm tách khỏi hệ thống nó bảo vệ (quy tắc 3-2-1: 3 bản, 2 loại lưu trữ, 1 bản ngoài site).</p>`,
    pros: ['Quay về được điểm trước khi dữ liệu bị xoá hay hỏng', 'Chống lỗi con người, bug ghi sai và ransomware mà replica không chống được', 'RPO/RTO đo được và chọn được theo chi phí'],
    cons: ['Tốn đĩa và IO mỗi lần snapshot', 'Mất các ghi sau snapshot cuối (RPO > 0)', 'Khôi phục có downtime (RTO) và chưa thử thì có thể vô dụng'],
    real: 'Năm 2014 Code Spaces bị kẻ tấn công vào bảng điều khiển AWS xoá dữ liệu cùng các bản backup nằm trong cùng tài khoản; công ty đóng cửa gần như ngay sau đó.',
    tryIt: 'Bật Backup hằng giờ rồi hằng ngày; gây dataloss trong Chaos Lab và so số bản ghi mất khi khôi phục với đĩa và IO bạn phải trả.',
    see: ['concept-durability', 'concept-replication', 'inc-dataloss', 'comp-db', 'concept-capacity-cost'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-chaos', cat: 'concept',
    title: 'Chaos engineering & game day',
    summary: 'Chủ động gây lỗi có kiểm soát để kiểm chứng hệ thống thực sự chịu được lỗi trước khi sự cố thật xảy ra.',
    body: `<p>Chaos engineering là thực nghiệm khoa học trên hệ thống: (1) xác định <b>steady state</b> bằng metric đo được (tỉ lệ thành công, p99); (2) đưa ra giả thuyết rằng steady state giữ nguyên khi có lỗi; (3) tiêm lỗi thực tế (tắt node, thêm độ trễ, cắt mạng); (4) tìm sai khác và sửa. Bắt đầu nhỏ, kiểm soát blast radius và có nút dừng.</p><p><b>Game day</b> là buổi diễn tập có chuẩn bị: cả nhóm thực hành xử lý sự cố, kiểm tra runbook và giám sát. Trong game: <b>Chaos Lab</b> (công trình cấp 3) cho phép kích hoạt thủ công một sự cố đã gặp; nó không bị tính vào SLO ngày và không làm mất user. Hãy dùng nó để kiểm chứng giả thuyết kiến trúc.</p>`,
    pros: ['Phát hiện điểm yếu trước khi sự cố thật', 'Rèn kỹ năng ứng phó và runbook', 'Tăng niềm tin vào cơ chế dư thừa'],
    cons: ['Có rủi ro nếu không kiểm soát blast radius', 'Cần giám sát tốt để so sánh steady state', 'Tốn thời gian và cần văn hoá chấp nhận'],
    real: 'Netflix phát triển Chaos Monkey và Simian Army, và công bố bộ nguyên tắc "Principles of Chaos Engineering".',
    tryIt: 'Đặt giả thuyết "mất 1 App vẫn đạt SLO", dùng Chaos Lab kích hoạt crash và kiểm tra.',
    see: ['inc-crash', 'concept-slo', 'concept-observability', 'concept-postmortem'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-postmortem', cat: 'concept',
    title: 'Post-mortem không đổ lỗi',
    summary: 'Học từ sự cố bằng cách phân tích hệ thống và quy trình, không truy lỗi cá nhân.',
    body: `<p>Post-mortem ghi lại: dòng thời gian, tác động, nguyên nhân gốc, cái gì làm tốt, cái gì kém, và <b>action items</b> có chủ sở hữu và hạn. Văn hoá <b>blameless</b> giả định mọi người đã hành động hợp lý với thông tin họ có; nếu bị đổ lỗi, người ta sẽ giấu sự thật và bạn mất bài học. Kỹ thuật <b>5 whys</b> hỏi "tại sao" liên tiếp để đi từ triệu chứng tới nguyên nhân hệ thống (thường là thiếu cơ chế bảo vệ, không phải một người).</p><p>Trong game: mỗi sự cố sinh một <b>Post-mortem</b> với tác động (thời gian, % lỗi tối đa, p99 tối đa, user ảnh hưởng), danh sách "bạn có X không?" (✓/✗ kèm lý do thật) và gợi ý Codex. Hãy biến mỗi ✗ thành một action item.</p>`,
    pros: ['Biến sự cố thành học hỏi có hệ thống', 'Action items ngăn tái diễn', 'Văn hoá an toàn khuyến khích báo cáo trung thực'],
    cons: ['Tốn thời gian nếu làm hình thức', 'Action items không theo dõi sẽ vô nghĩa', 'Cần sự ủng hộ của lãnh đạo cho blameless'],
    real: 'Google SRE book có chương "Postmortem Culture: Learning from Failure"; Etsy phổ biến khái niệm blameless postmortem.',
    tryIt: 'Sau một sự cố, đọc Post-mortem trong game và biến mỗi mục ✗ thành một hành động cụ thể.',
    see: ['concept-chaos', 'concept-observability', 'concept-slo', 'inc-baddeploy'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-autoscaling', cat: 'concept',
    title: 'Autoscaling: reactive vs predictive',
    summary: 'Tự động thêm/bớt năng lực theo tải; có độ trễ khởi động và chi phí cần cân nhắc.',
    body: `<p>Autoscaling <b>reactive</b> phản ứng với metric (CPU, queue depth) khi vượt ngưỡng — đơn giản nhưng luôn chậm hơn tải vì có độ trễ đo, quyết định và khởi động (warm-up lag). <b>Predictive</b>/scheduled scale trước theo mẫu thời gian đã biết (giờ cao điểm). <b>Cooldown</b> ngăn thêm/bớt liên tục (thrashing). Ngưỡng thấp scale sớm nhưng tốn tiền; ngưỡng cao tiết kiệm nhưng rủi ro. Cũng cần giới hạn tối đa để tránh hoá đơn bùng nổ và đừng quên nút thắt phía sau (DB).</p><p>Trong game: <b>Autoscaler</b> (module trên LB) thêm instance ảo khi util &gt; 70%, mất 15 s khởi động và tốn điện. Một spike kéo dài ~40 s nên nó không kịp đỡ đỉnh đầu; hãy kết hợp với rate limit, và nhớ tải tăng theo giờ cao điểm (×1.25).</p><p><b>HPA</b> của Kubernetes cùng ngưỡng 70% nhưng container khởi động nhanh hơn: 8 s so với 15 s; bớt instance khi util &lt; 30% trong 30 s, tối đa +6. Chỉ áp dụng cho App đã cài Module Docker, và đổi lại bạn trả độ phức tạp và điện của cả cluster.</p>`,
    pros: ['Tiết kiệm khi tải thấp, đủ năng lực khi tải cao', 'Giảm can thiệp thủ công', 'Predictive tránh được độ trễ khởi động'],
    cons: ['Reactive luôn chậm hơn đỉnh tải', 'Chi phí có thể tăng khó lường', 'Không giúp nếu nút thắt là DB hoặc dependency khác'],
    real: 'AWS Auto Scaling hỗ trợ target tracking, scheduled và predictive scaling với cooldown/warm-up cấu hình được; Kubernetes HPA có cơ chế tương tự.',
    tryIt: 'Bật autoscaler và quan sát đợt tăng instance sau 15 s khi spike; thử thêm rate limit.',
    see: ['inc-spike', 'comp-lb', 'concept-scaling', 'concept-capacity-cost', 'concept-cold-start', 'comp-k8s', 'concept-orchestration'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-alerting', cat: 'concept',
    title: 'Alerting, on-call & alert fatigue',
    summary: 'Cảnh báo tốt gọi đúng người, đúng lúc, về thứ đáng làm ngay; ngưỡng quá nhạy hay quá chặt đều làm hỏng điều đó.',
    body: `<p>Một <b>alert</b> là quy tắc trên metric: "tỉ lệ lỗi ≥ 5% liên tục 6 giây thì page người on-call". Ba chỉ số đo chất lượng của cả chuỗi: <b>MTTD</b> (từ lúc lỗi bắt đầu tới lúc có alert), <b>MTTA</b> (từ alert tới lúc có người nhận/ack) và <b>MTTR</b> (tới lúc khôi phục). Alert chỉ rút ngắn được hai cái đầu; cái cuối là việc của runbook và tự động hoá.</p>
<p><b>Nhạy hay chặt</b> là đánh đổi, không có đáp án đúng cho mọi hệ thống: ngưỡng thấp và <code>for</code> ngắn báo sớm, nhưng kêu cả khi chỉ là nhiễu thoáng qua (<b>báo động giả</b>); ngưỡng cao yên tĩnh, nhưng chỉ kêu khi <b>người dùng đã lỗi</b>. Báo động giả làm người trực mất ngủ và dạy cả đội phớt lờ pager (<b>alert fatigue</b>), đến khi một page thật bị bỏ qua.</p>
<ul>
<li><b>Triệu chứng và nguyên nhân</b>: alert theo triệu chứng (lỗi, p99: người dùng đang đau) ít nhiễu và luôn đáng hành động; alert theo nguyên nhân (utilization, đĩa) báo sớm hơn nhưng dễ kêu khi chưa có hại gì. Đừng page vì CPU 50%.</li>
<li><b>SLO burn</b>: thay vì ngưỡng cố định, báo khi tốc độ đốt ngân sách lỗi đủ nhanh để vỡ SLO trước hạn.</li>
<li><b>Dedup và gộp</b>: một điều kiện không được page lại mỗi giây, và nhiều quy tắc cùng vi phạm trên một node chỉ nên là một page.</li>
<li><b>Escalation</b>: không ai ack trong thời hạn thì page cả đội; alert không có chủ chỉ là tiếng ồn.</li>
<li>Trong game: chỉnh <b>Mức cảnh báo</b> ở Đèn giám sát (Tắt, Nhạy, Vừa, Chặt). Người on-call đổi mỗi ngày (hoặc nhận ca); ack bằng phím V trong 20 giây, quá hạn thì cả đội bị page và người trực mất tỉnh táo; mỗi page giả cũng tốn tỉnh táo. Component ngoài vùng đèn không có alert nào, post-mortem ghi MTTD, MTTA và số báo động giả.</li>
</ul>`,
    pros: ['Rút ngắn MTTD và MTTA, người dùng chịu lỗi ít hơn', 'Có chủ rõ ràng nhờ on-call và escalation', 'Ngưỡng theo triệu chứng ít nhiễu và dễ hành động'],
    cons: ['Ngưỡng nhạy gây báo động giả và alert fatigue', 'Ngưỡng chặt phát hiện muộn, người dùng đã lỗi', 'Ngưỡng cố định lệch dần khi tải tăng nên cần chỉnh lại', 'On-call tốn sức người và tỉnh táo'],
    real: 'Google SRE Workbook (chương "Alerting on SLOs") khuyên cảnh báo theo tốc độ đốt error budget nhiều cửa sổ thời gian thay vì ngưỡng đơn giản; PagerDuty và Opsgenie chuẩn hoá luồng on-call, ack và escalation.',
    tryIt: 'Đặt Mức cảnh báo ở Đèn giám sát là Nhạy rồi để yên một lúc để đếm báo động giả; sau đó đặt Chặt và gây crash trong Chaos Lab để so MTTD trong post-mortem.',
    see: ['concept-observability', 'comp-lantern', 'concept-slo', 'concept-postmortem', 'inc-spike'],
    symptoms: [], mitigations: []
  },
  {
    id: 'concept-deploy-strategies', cat: 'concept',
    title: 'Chiến lược deploy: big bang, canary & blue/green',
    summary: 'Cùng một bản lỗi, cách phát hành quyết định bao nhiêu người dùng thấy lỗi và bạn quay lại nhanh cỡ nào.',
    body: `<p>Ba trục để so sánh: <b>blast radius</b> (bao nhiêu người dùng chạm bản mới), <b>thời gian phát hiện và rollback</b> (lỗi kéo dài bao lâu) và <b>chi phí</b> (hạ tầng chạy song song, độ phức tạp).</p>
<ul>
<li><b>Big bang (deploy thẳng)</b>: thay hết trong một lần. Rẻ và đơn giản, nhưng mọi người dùng chạm bản lỗi ngay và có downtime khi khởi động lại; rollback là một lần deploy nữa.</li>
<li><b>Canary</b>: chỉ một phần nhỏ traffic (10% trong game) dùng bản mới trong một <i>cửa sổ quan sát</i>; bạn so error rate của phần canary với bản cũ rồi mới <i>promote</i> lên 100% hoặc rollback. Blast radius nhỏ, nhưng chỉ bảo vệ được khi có người (hoặc máy) theo dõi: không ai rollback thì hết cửa sổ bản lỗi vẫn tự lên 100%.</li>
<li><b>Blue/green</b>: dựng môi trường mới (green) song song môi trường cũ (blue) rồi chuyển traffic. Không downtime và rollback tức thì (chuyển lại), nhưng traffic chuyển một lần nên blast radius vẫn lớn, và bạn trả gấp đôi tài nguyên cho tới khi gỡ môi trường cũ; sau đó rollback lại tốn một lần deploy.</li>
<li><b>Rolling update</b> (Kubernetes): thay từng pod, pod mới lên trước khi pod cũ tắt; readiness probe chặn bản lỗi và tự rollback.</li>
<li>Trong game: chọn <b>Deploy thẳng / Canary / Blue-green</b> ở Cấu hình của App (Canary tốn 1 linh kiện, Blue/green tốn 2 linh kiện + 1 đồng mỗi lần deploy, cả hai tốn thêm điện và độ phức tạp trong cửa sổ). Nút <b>Promote</b> đẩy bản mới lên 100% sớm, <b>Rollback</b> trong cửa sổ không cần reboot. App container hoá nằm sau Kubernetes luôn dùng rolling update của Kubernetes, bất kể cấu hình.</li>
</ul>`,
    pros: ['Canary: lỗi chỉ chạm một phần nhỏ người dùng', 'Blue/green: không downtime, rollback tức thì', 'Cửa sổ quan sát cho bạn thời gian nhìn số liệu trước khi cam kết'],
    cons: ['Canary chỉ hiệu quả khi có giám sát và người rollback kịp', 'Blue/green gấp đôi tài nguyên và vẫn lộ 100% traffic cho bản lỗi', 'Cả hai cần hỗ trợ hai phiên bản chạy song song (schema, API tương thích)', 'Big bang rẻ nhất nhưng blast radius lớn nhất'],
    real: 'Netflix dùng Kayenta để tự động so sánh metric của canary với baseline trước khi promote; AWS CodeDeploy và Argo Rollouts hỗ trợ cả canary lẫn blue/green với rollback tự động theo alarm.',
    tryIt: 'Đặt Canary ở một App trong vùng sáng, deploy vài lần và nhìn "canary lỗi X%" trong inspector; rollback khi lỗi, rồi để yên một lần để xem bản lỗi tự lên 100%. Sau đó thử Blue/green và so thời gian lỗi trong post-mortem.',
    see: ['concept-blast-radius', 'inc-baddeploy', 'concept-observability', 'comp-app', 'comp-k8s', 'comp-docker'],
    symptoms: [], mitigations: []
  }
];
