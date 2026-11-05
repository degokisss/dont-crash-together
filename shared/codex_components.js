// Field Guide (Codex) — nội dung component & khái niệm. Tiếng Việt, thuật ngữ kỹ thuật giữ nguyên tiếng Anh.
// Mỗi entry: { id, cat, title, summary, body(HTML), pros, cons, real, tryIt, see }

export const CODEX_COMPONENTS = [
  {
    id: 'comp-gateway',
    cat: 'component',
    title: 'API Gateway',
    summary: 'Cổng vào duy nhất của hệ thống: định tuyến, giới hạn tốc độ, lọc request độc hại.',
    body: `<p>API Gateway là điểm chạm đầu tiên của mọi request: nó xác thực, định tuyến, áp <b>rate limit</b> và (với WAF) lọc payload độc hại trước khi chạm tới backend. Vì đứng ở rìa nên đây là chỗ rẻ nhất để từ chối tải xấu.</p>
<ul>
<li><b>Rate limit (req/s)</b>: trong game, vượt ngưỡng thì request bị loại bỏ — bạn chủ động hy sinh một phần user hợp lệ để cả hệ thống không sập (load shedding). Đặt quá thấp là tự DoS chính mình.</li>
<li><b>WAF</b> (cần module): chặn ~95% request độc hại của DDoS, nhưng tốn tài nguyên và có thể chặn nhầm.</li>
<li>Gateway chỉ chuyển tới <b>một</b> đích khoẻ đầu tiên trong danh sách cáp: thứ tự cáp chính là thứ tự failover.</li>
</ul>
<p>Gateway cũng là <b>SPOF</b> tiềm tàng: mọi thứ đi qua nó, nên nó cần đơn giản và dư thừa.</p>`,
    pros: ['Chặn tải xấu sớm, bảo vệ backend', 'Một chỗ tập trung auth, logging, rate limit', 'Cho phép shed load có kiểm soát'],
    cons: ['Là SPOF nếu chỉ có một', 'Thêm một hop và độ trễ', 'Rate limit sai làm từ chối cả user hợp lệ'],
    real: 'Kong, AWS API Gateway, Envoy và NGINX thường đảm nhiệm vai trò này; Cloudflare WAF lọc traffic độc hại ở rìa mạng.',
    tryIt: 'Khi DDoS đến, bật WAF rồi hạ Rate limit từng nấc; quan sát % lỗi của user thật so với tải ở backend.',
    see: ['comp-turret', 'inc-ddos', 'concept-load-shedding', 'concept-spof']
  },
  {
    id: 'comp-cdn',
    cat: 'component',
    title: 'CDN',
    summary: 'Phục vụ nội dung tĩnh từ edge gần người dùng, gỡ phần lớn tải tĩnh khỏi origin.',
    body: `<p>CDN là một cache phân tán đặt ở rìa mạng. Nội dung tĩnh (ảnh, JS, CSS) được trả từ edge gần người dùng nên vừa giảm độ trễ vừa giảm tải origin. Nó hiệu quả vì nội dung tĩnh <i>cacheable</i> cao và đọc rất nhiều lần.</p>
<ul>
<li>Trong game, lớp <b>tĩnh</b> chiếm 30% traffic hợp lệ; Gateway đẩy lớp này qua CDN nếu có.</li>
<li>Hit ~92% <b>sau khi ấm</b> (warm-up): CDN mới đặt sẽ có nhiều miss lúc đầu.</li>
<li>Miss chuyển về origin (cáp đầu tiên), nên origin vẫn phải gánh ~8% lớp tĩnh.</li>
<li>Origin của CDN có thể là <b>Object Storage (S3)</b>: miss lớp tĩnh lấy từ S3 (45 ms, 0,1 công) thay vì làm App tốn 1 công.</li>
</ul>
<p>Cái giá: nội dung có thể cũ (cần purge/versioned URL), và CDN không giúp gì cho request đọc động hay ghi, nên không thay được scale-out cho App/DB.</p>`,
    pros: ['Giảm mạnh tải tĩnh trên origin', 'Giảm độ trễ cho user ở xa', 'Hấp thụ spike lớp tĩnh'],
    cons: ['Không giúp request động/ghi', 'Invalidate/purge khó, dữ liệu có thể cũ', 'Phải trả phí và điện', 'Origin S3 chết thì phải fallback sang origin khác'],
    real: 'Cloudflare, Akamai và Amazon CloudFront cache nội dung tĩnh tại hàng trăm điểm hiện diện (PoP) toàn cầu.',
    tryIt: 'Đặt CDN lúc đang có spike và xem tải Gateway→App của lớp tĩnh giảm dần khi CDN ấm lên.',
    see: ['comp-cache', 'comp-gateway', 'inc-spike', 'concept-cache-ttl', 'comp-s3']
  },
  {
    id: 'comp-lb',
    cat: 'component',
    title: 'Load Balancer',
    summary: 'Chia request cho nhiều App, phát hiện node chết và cho phép scale ngang.',
    body: `<p>Load Balancer (LB) cho phép nhiều bản sao App cùng gánh tải. Chọn thuật toán là chọn cách chia công bằng:</p>
<ul>
<li><b>Round-robin</b>: chia đều bất kể sức mạnh. Đơn giản, nhưng node tier thấp sẽ quá tải trước khi node tier cao còn rảnh.</li>
<li><b>Least-connections</b>: chia theo công suất còn trống, tự bù khi node không đồng đều hoặc chậm.</li>
<li><b>Hash/sticky</b>: cùng key vào cùng node (tốt cho cache cục bộ, session), nhưng có <b>skew</b>: một node nhận nhiều hơn hẳn, nhất là khi hot key.</li>
</ul>
<p>LB phát hiện node chết bằng health check sau ~4 s; trong khoảng đó nó vẫn gửi request vào node chết nên vẫn có lỗi. Module <b>Autoscaler</b> thêm instance ảo khi util &gt; 70% (khởi động 15 s, tốn điện). Không có LB, nhiều App chỉ có App đầu tiên nhận tải.</p>
<p>So với <b>Kubernetes Cluster</b>: LB chỉ chia tải và (với Autoscaler) thêm instance; K8s còn tự restart App crash, scale bằng HPA (8 s), rolling update và auto-rollback, nhưng nặng hơn (0,4 công/request so với 0,3), tốn 4 W, độ phức tạp +6 và control plane là SPOF. Với monolith nhỏ, LB là đủ.</p>`,
    pros: ['Scale ngang và N+1 redundancy', 'Che node chết khỏi user (sau health check)', 'Autoscaler hấp thụ spike'],
    cons: ['Bản thân LB có thể là SPOF', 'Cửa sổ ~4 s vẫn gửi vào node chết', 'Hash gây skew, round-robin bỏ qua sức mạnh khác nhau'],
    real: 'NGINX, HAProxy, Envoy và AWS ELB/ALB là các load balancer phổ biến; HAProxy hỗ trợ cả roundrobin, leastconn và hash.',
    tryIt: 'Đặt 3 App khác tier sau LB: chạy Round-robin rồi đổi Least-connections và so sánh util từng node.',
    see: ['concept-lb-algos', 'concept-health-checks', 'concept-autoscaling', 'inc-hotkey', 'comp-k8s']
  },
  {
    id: 'comp-app',
    cat: 'component',
    title: 'App Server',
    summary: 'Nơi chạy logic nghiệp vụ; nên stateless để scale ngang, và là nơi đặt retry/breaker/deploy.',
    body: `<p>App Server xử lý logic: đọc đi qua Cache (nếu có) rồi tới DB; ghi đi vào Queue (nếu có) hoặc thẳng DB. Nó nên <b>stateless</b> để nhân bản dễ dàng sau LB.</p>
<ul>
<li><b>Tier 1–3</b>: scale up cần <b>reboot ~10 s</b> — vertical scaling có downtime và có trần.</li>
<li><b>Retries 0–3</b> + <b>backoff+jitter</b>: retry cứu lỗi thoáng qua nhưng nhân tải lên downstream đang yếu; backoff có jitter làm các lần thử rải đều.</li>
<li><b>Circuit breaker</b>: mở khi &gt;50% lỗi từ downstream, fail fast và thăm dò 5% để biết khi nào hồi phục.</li>
<li><b>Deploy</b>: 30% rủi ro bản lỗi (~40% request mà bản lỗi phục vụ bị lỗi, <i>không thấy nếu không giám sát</i>). Chọn <b>chiến lược deploy</b> ở Cấu hình: <i>deploy thẳng</i> (reboot 5 s, 100% request chạm bản mới), <i>canary</i> (10% request trong cửa sổ 24 s, rồi tự lên 100% nếu không ai Rollback), <i>blue/green</i> (không downtime, Rollback tức thì trong cửa sổ 18 s, tốn gấp đôi điện). Có <b>Promote</b>, <b>Rollback</b> và <b>Restart</b>. App container hoá nằm sau Kubernetes luôn dùng rolling update của K8s.</li>
<li><b>Module Docker</b>: container hoá App — restart nhanh gấp đôi, deploy lỗi giảm xuống 12% (Backend Dev 5%), đổi lấy -4% công suất và độ phức tạp +1. Là điều kiện để <b>Kubernetes</b> tự chữa, HPA và rolling update cho App; không container thì K8s chỉ cân bằng tải.</li>
</ul>
<p>Deploy từng bước (canary) giới hạn blast radius; deploy hết cùng lúc là đánh cược.</p>`,
    pros: ['Stateless nên scale ngang dễ', 'Breaker/backoff giữ hệ thống khỏi sụp dây chuyền', 'Deploy canary hoặc blue/green + rollback giảm rủi ro', 'Module Docker giảm deploy lỗi và restart nhanh'],
    cons: ['Scale up cần reboot', 'Retry sai cách gây retry storm', 'Deploy lỗi âm thầm nếu thiếu giám sát', 'Docker: -4% công suất, độ phức tạp +1'],
    real: 'Netflix phổ biến mô hình circuit breaker qua Hystrix; AWS Builders Library khuyến nghị exponential backoff kèm jitter.',
    tryIt: 'Đặt Retries=3 không backoff rồi gây spike; sau đó bật backoff+jitter và breaker, so sánh p99.',
    see: ['concept-retry-storm', 'concept-circuit-breaker', 'inc-baddeploy', 'concept-deploy-strategies', 'inc-leak', 'concept-scaling', 'comp-docker', 'comp-k8s']
  },
  {
    id: 'comp-cache',
    cat: 'component',
    title: 'Cache',
    summary: 'Bộ nhớ nhanh đặt trước DB để giảm đọc, đổi lấy độ cũ của dữ liệu và rủi ro stampede.',
    body: `<p>Cache giữ kết quả đọc để khỏi hỏi DB. Mẫu <b>cache-aside</b> để app tự đọc cache rồi tự nạp khi miss; <b>read-through</b> để cache tự nạp từ DB. Game mô phỏng read-through: hit trả ngay, miss chuyển tới DB.</p>
<ul>
<li><b>TTL 10/30/60 s</b>: dài hơn thì hit cao hơn nhưng dữ liệu cũ hơn.</li>
<li><b>Jitter</b>: không bật thì mọi key hết hạn cùng lúc mỗi chu kỳ TTL → stampede (hit ~10% trong ~3 s). Hãy bật Jitter ở Cache.</li>
<li><b>Request coalescing</b>: nhiều request cùng key chỉ gửi một lần xuống DB.</li>
<li><b>Cold start</b>: cache mới/khởi động lại mất ~20 s mới ấm; DB phải chịu tải trần trong lúc đó.</li>
</ul>
<p>Invalidate khó vì phải biết khi nào dữ liệu gốc đổi; vì thế TTL thường là lựa chọn "đủ tốt".</p>`,
    pros: ['Giảm tải đọc cho DB rất lớn', 'Giảm độ trễ đọc', 'Che hot key khỏi DB'],
    cons: ['Dữ liệu có thể cũ', 'Stampede khi key hết hạn đồng loạt', 'Cold start làm DB lộ ra đột ngột'],
    real: 'Redis và Memcached là cache in-memory phổ biến; Facebook đã công bố bài báo về dùng Memcached ở quy mô lớn và cơ chế leases chống thundering herd.',
    tryIt: 'Tắt Jitter, đặt TTL 10 s và chờ chu kỳ hết hạn; rồi bật Jitter + Coalescing và so sánh đỉnh tải DB.',
    see: ['inc-stampede', 'concept-cache-ttl', 'concept-cold-start', 'comp-db']
  },
  {
    id: 'comp-queue',
    cat: 'component',
    title: 'Message Queue',
    summary: 'Tách ghi khỏi DB bằng hàng đợi: ack sớm, xả dần theo sức DB; backlog chính là lag.',
    body: `<p>Queue tách producer khỏi consumer theo thời gian. App ghi vào Queue và nhận ack ngay; Queue xả dần vào DB theo <b>công suất DB còn trống</b>. Spike ghi bị làm phẳng thành một dòng đều.</p>
<ul>
<li><b>Backlog = lag</b>: số việc chờ xử lý; game đo <b>lag</b> để bạn thấy dữ liệu "đã ack" nhưng chưa thực sự nằm trong DB.</li>
<li><b>Backpressure</b>: DB chậm thì Queue đầy; backlog đầy → <b>từ chối ghi</b>. Đó là tín hiệu ngược để upstream giảm tốc, không phải lỗi.</li>
<li>Tier cao hơn = backlog lớn hơn, đệm được spike dài hơn.</li>
</ul>
<p>Queue chỉ dời vấn đề: nếu tải trung bình vượt công suất DB, backlog tăng mãi. Và nó đổi consistency lấy khả năng chịu tải: đọc ngay sau ghi có thể chưa thấy dữ liệu.</p>`,
    pros: ['Làm phẳng spike ghi', 'Ack nhanh, latency ghi thấp', 'Tách lỏng producer và consumer'],
    cons: ['Eventual consistency, đọc sau ghi có thể chưa thấy', 'Backlog đầy thì từ chối ghi', 'Thêm một thành phần phải vận hành'],
    real: 'Apache Kafka, RabbitMQ và Amazon SQS là các hệ thống hàng đợi/log phổ biến để tách ghi bất đồng bộ.',
    tryIt: 'Gây spike ghi với Queue rồi không có Queue; so sánh tỷ lệ lỗi ghi và quan sát lag tăng rồi giảm.',
    see: ['concept-backpressure', 'comp-db', 'inc-spike', 'concept-durability']
  },
  {
    id: 'comp-db',
    cat: 'component',
    title: 'Database',
    summary: 'Nơi giữ dữ liệu bền vững: nút cổ chai điển hình, scale khó nhất vì có trạng thái.',
    body: `<p>Database là thành phần có trạng thái, nên khó scale nhất. Công suất đọc/ghi dùng chung: <b>đọc cost 2, ghi cost 5</b>, tức ghi đắt hơn đọc 2,5 lần.</p>
<ul>
<li><b>Shards 1–4</b>: chia dữ liệu theo key; vì có <b>skew</b> nên không scale tuyến tính. <b>Key salting</b> giảm skew.</li>
<li><b>Replication sync/async</b>: sync không mất dữ liệu nhưng ghi thất bại nếu replica không với tới (CP); async nhanh nhưng mất ghi chưa sao chép khi leader chết.</li>
<li><b>Failover</b>: tắt / tự động / quorum. Tự động + async + partition có thể gây split-brain; quorum cần ≥3 node.</li>
<li><b>Retention</b> làm đĩa đầy chậm hơn; <b>Archive</b> dọn đĩa. Đĩa đầy → ghi thất bại.</li>
<li><b>Backup/archive tới S3</b>: nối DB tới Object Storage để snapshot mỗi 30 s (xem số giây từ lần backup cuối trong inspector) và offload dữ liệu lạnh, đĩa đầy chậm hơn 25%. Không có backup, mất đĩa là mất mọi ghi từ đầu.</li>
</ul>
<p>Ghi chỉ vào <b>leader</b>; đọc có thể chia cho Replica.</p>`,
    pros: ['Nguồn sự thật và độ bền dữ liệu', 'Shard + replica mở rộng đọc/ghi', 'Failover tăng availability', 'Nối S3 để có backup và đĩa đầy chậm hơn'],
    cons: ['Scale ghi khó, shard có skew', 'Đĩa đầy làm ghi thất bại', 'Failover sai gây mất dữ liệu/split-brain', 'Không có backup thì mất đĩa là mất sạch dữ liệu'],
    real: 'PostgreSQL dùng streaming replication (sync hoặc async); Vitess shard MySQL ở quy mô lớn (xuất phát từ YouTube).',
    tryIt: 'Chuyển Replication sang async rồi giết leader: xem ghi bị mất; so với sync khi cắt cáp tới replica.',
    see: ['comp-replica', 'comp-s3', 'concept-replication', 'concept-sharding', 'inc-diskfull', 'inc-partition', 'concept-split-brain']
  },
  {
    id: 'comp-replica',
    cat: 'component',
    title: 'Read Replica',
    summary: 'Bản sao chỉ đọc của primary: chia tải đọc và làm ứng viên thăng cấp khi primary chết.',
    body: `<p>Read Replica nhận đọc từ DB primary nên giải phóng công suất cho ghi. Nó cũng là nơi lý tưởng để cô lập các truy vấn nặng (báo cáo analytics) khỏi workload chính.</p>
<ul>
<li><b>Replication lag</b>: bản sao chậm hơn primary; trong game độ trễ sao chép tăng khi primary quá tải — đúng lúc bạn cần nó nhất, replica lại đọc dữ liệu cũ nhất.</li>
<li><b>Promotion</b>: khi primary chết, replica có thể được thăng cấp thành leader (tuỳ chế độ failover). Replica càng trễ, ghi bị mất càng nhiều nếu async.</li>
<li>Replica chỉ scale <i>đọc</i>; ghi vẫn dồn vào một leader.</li>
</ul>
<p>Muốn quorum phải có primary + 2 replica (≥3 node). Mỗi replica tốn điện và tăng độ phức tạp vận hành.</p>`,
    pros: ['Scale đọc, cô lập workload nặng', 'Ứng viên failover', 'Giúp quorum (≥3 node)'],
    cons: ['Đọc dữ liệu cũ do lag', 'Không scale ghi', 'Tốn điện và thêm độ phức tạp'],
    real: 'Amazon RDS và PostgreSQL hỗ trợ read replica; MySQL replica cũng được dùng rộng rãi cho báo cáo và đọc.',
    tryIt: 'Gây sự cố analytics khi có và không có Replica; so sánh p99 của luồng ghi chính.',
    see: ['comp-db', 'concept-replication', 'inc-analytics', 'concept-cap']
  },
  {
    id: 'comp-s3',
    cat: 'component',
    title: 'Object Storage (S3)',
    summary: 'Kho object rẻ và bền: origin cho nội dung tĩnh và đích backup/archive cho DB.',
    body: `<p>Object Storage lưu file/blob theo key, rất rẻ trên mỗi request và co giãn gần như vô hạn, nhưng chậm hơn compute hay edge cache. Trong game nó có hai vai trò:</p>
<ul>
<li><b>Origin tĩnh</b>: Gateway hoặc CDN nối tới S3 sẽ lấy lớp tĩnh (30% traffic) từ đây. Mỗi request tốn 0,1 công (App tốn 1), độ trễ cơ bản 45 ms (chậm hơn một CDN edge hit ~8 ms nhưng rẻ hơn compute nhiều), công suất 6000.</li>
<li><b>Đích backup + offload dữ liệu lạnh</b>: DB nối tới S3 chụp snapshot mỗi 30 s (đặt lại "dữ liệu ghi từ lần backup cuối") và đĩa đầy chậm hơn 25%. Không có backup nào, mất đĩa DB là mất mọi thứ ghi từ lúc bắt đầu.</li>
<li>Nếu S3 chết, health check của bên gọi (~3 s) chuyển sang origin kế tiếp theo thứ tự cáp (ví dụ App).</li>
</ul>
<p>S3 là một thành phần logic duy nhất, nên cũng là SPOF cho phần tĩnh: nhiều thứ cùng phụ thuộc vào nó.</p>`,
    pros: ['Rẻ trên mỗi request (0,1 công), công suất lớn', 'Cho DB backup/snapshot và offload dữ liệu lạnh', 'Gỡ tải tĩnh khỏi App'],
    cons: ['Chậm hơn CDN edge (~45 ms so với ~8 ms)', 'Là SPOF cho nội dung tĩnh nếu không có origin dự phòng', 'Không phục vụ request động/ghi'],
    real: 'Sự cố AWS S3 us-east-1 ngày 28/2/2017 xảy ra do một lệnh gõ sai trong lúc gỡ lỗi, làm nhiều dịch vụ phụ thuộc ngừng hoạt động.',
    tryIt: 'Nối Gateway tới S3 rồi tới App; chạy crash trên S3 và xem lớp tĩnh chuyển về App sau ~3 s. Nối DB tới S3 và quan sát số giây từ lần backup cuối.',
    see: ['comp-cdn', 'comp-gateway', 'comp-db', 'concept-durability', 'concept-spof', 'inc-diskfull', 'inc-crash']
  },
  {
    id: 'comp-k8s',
    cat: 'component',
    title: 'Kubernetes Cluster',
    summary: 'Ingress + scheduler: định tuyến theo công suất trống, tự chữa và tự scale các App đã container hoá.',
    body: `<p>Kubernetes Cluster đứng giữa Gateway/CDN và các App. Nó chọn App theo công suất còn trống (kiểu least-connections), phát hiện pod chết sau ~1 s nhờ readiness probe (LB thường mất ~4 s).</p>
<ul>
<li><b>Self-healing</b>: App đã container hoá (Module Docker) bị crash/OOM sẽ được restart tự động ~6 s sau, không cần kỹ sư.</li>
<li><b>HPA</b>: thêm instance khi util nhóm &gt; 70% (khởi động 8 s so với 15 s của Autoscaler trên LB), bớt khi &lt; 30% trong 30 s, tối đa +6.</li>
<li><b>Rolling update</b>: deploy chỉ ~1 s downtime (so với 5 s) và readiness probe thất bại sẽ tự rollback bản lỗi sau ~10 s.</li>
<li>App <i>chưa</i> container hoá nối vào chỉ được cân bằng tải: không healing, HPA hay rollback.</li>
</ul>
<p>Cái giá: 4 W điện, độ phức tạp +6 (tải nhận thức), 0,4 công mỗi request (nặng hơn LB 0,3), công suất 2500. Control plane là SPOF và không tự chữa. Với một monolith nhỏ, đây là overkill.</p>`,
    pros: ['Tự chữa và tự scale cho App container hoá', 'Rolling update ít downtime, tự rollback bản lỗi', 'Phát hiện pod chết nhanh (~1 s)'],
    cons: ['Độ phức tạp +6 và tốn 4 W điện', 'Control plane là SPOF, không tự chữa', 'Nặng hơn LB (0,4 vs 0,3 công/request); overkill cho monolith'],
    real: 'Kubernetes được Google mở mã nguồn năm 2014 và kế thừa từ hệ thống nội bộ Borg.',
    tryIt: 'Cài Module Docker lên App, nối Gateway → Kubernetes → App rồi chạy crash và leak; so sánh với LB + Restart thủ công, và để ý Tỉnh táo giảm.',
    see: ['comp-docker', 'comp-app', 'comp-lb', 'concept-orchestration', 'concept-health-checks', 'concept-autoscaling', 'concept-complexity', 'concept-spof', 'inc-crash', 'inc-leak', 'inc-baddeploy']
  },
  {
    id: 'comp-docker',
    cat: 'component',
    title: 'Docker (Module container)',
    summary: 'Module cài lên App: đóng gói image bất biến, restart nhanh, ít deploy lỗi; điều kiện để Kubernetes quản lý.',
    body: `<p>Module Docker được cài ở inspector của một App, biến nó thành <b>container hoá</b>. Hiệu ứng trong game:</p>
<ul>
<li>Thời gian reboot/restart giảm một nửa (container khởi động nhanh).</li>
<li>Xác suất deploy lỗi giảm từ 30% xuống 12% (Backend Dev: 12% → 5%) vì image bất biến loại bỏ lệch môi trường "works on my machine".</li>
<li>Công suất -4% do overhead runtime, độ phức tạp +1.</li>
<li>Là điều kiện tiên quyết để Kubernetes self-heal, scale bằng HPA và rolling update cho App.</li>
</ul>
<p>Docker một mình không tự chữa hay tự scale: nó chỉ làm đơn vị triển khai tốt hơn. Phần tự động hoá cần orchestrator.</p>`,
    pros: ['Restart nhanh gấp đôi', 'Giảm mạnh xác suất deploy lỗi', 'Mở đường cho Kubernetes'],
    cons: ['Công suất -4% do overhead runtime', 'Độ phức tạp +1', 'Không tự chữa nếu không có orchestrator'],
    real: 'Docker được mở mã nguồn năm 2013 và phổ biến hoá việc đóng gói ứng dụng bằng container image.',
    tryIt: 'Cài Module Docker lên một App rồi so thời gian restart và tần suất bản deploy lỗi trước/sau.',
    see: ['concept-containers', 'comp-k8s', 'comp-app', 'inc-baddeploy', 'concept-orchestration']
  },
  {
    id: 'comp-generator',
    cat: 'component',
    title: 'Máy phát điện',
    summary: 'Cấp điện và ánh sáng cho component; nhiên liệu là chi phí cloud, nên cần dự phòng.',
    body: `<p>Máy phát (bán kính ~8 ô) cấp điện cho component; hết nhiên liệu là component tắt. Trong game, điện là <b>chi phí cloud</b>: mỗi component tiêu thụ watt và máy phát đốt nhiên liệu theo <b>tổng watt</b>, nên mỗi component bạn thêm làm tăng burn rate.</p>
<ul>
<li>Burn rate tỷ lệ với watt, không phải số component: một Database tier cao đốt nhiều hơn vài Cache nhỏ.</li>
<li><b>Power domain dự phòng</b>: hai máy phát chồng lấn giúp khi một cái sập (sự cố <i>outage</i>, 30 s).</li>
<li>Máy phát cũng tạo vùng sáng nhỏ, nên cũng ảnh hưởng quan sát.</li>
</ul>
<p>Bài học: độ bền (redundancy) và hoá đơn đi ngược nhau; bạn cân giữa blast radius của một domain và chi phí chạy thêm.</p>`,
    pros: ['Dự phòng tránh mất điện toàn hệ thống', 'Cấp điện và ánh sáng cùng lúc', 'Burn rate cho thấy chi phí thật'],
    cons: ['Hết nhiên liệu là tắt component', 'Máy phát dự phòng tốn thêm nhiên liệu', 'Nhiều component tăng burn rate'],
    real: 'Các region/AZ của cloud độc lập về điện; AWS khuyến nghị trải workload qua nhiều Availability Zone để chịu lỗi một AZ.',
    tryIt: 'Đặt hai máy phát chồng lấn, kích hoạt outage trong Chaos Lab và so với khi chỉ có một máy phát.',
    see: ['inc-outage', 'concept-capacity-cost', 'concept-blast-radius', 'concept-spof']
  },
  {
    id: 'comp-lantern',
    cat: 'component',
    title: 'Đèn giám sát',
    summary: 'Biến vùng tối thành vùng quan sát được: không có metrics thì lỗi xảy ra trong im lặng.',
    body: `<p>Đèn giám sát tượng trưng cho <b>observability</b>: ba trụ cột là <b>metrics</b> (con số theo thời gian), <b>logs</b> (sự kiện rời rạc) và <b>traces</b> (đường đi một request qua các dịch vụ).</p>
<ul>
<li>Trong game, trong vùng sáng (đang có điện) bạn thấy metrics của component; ngoài vùng sáng thì không.</li>
<li><b>Coverage = visibility</b>: component ở ngoài vùng sáng vẫn có thể hỏng (ví dụ deploy lỗi ~40% lỗi) mà bạn không biết.</li>
<li>Ban đêm <b>Gremlin</b> gặm những thứ ngoài vùng sáng (hp → 0 = crash): thứ không được giám sát thì hỏng trong im lặng.</li>
</ul>
<p>Đèn cần điện, nên mất điện = mất mắt. Và giám sát nhiều cũng có giá: nhiều tín hiệu dễ gây alert fatigue.</p>`,
    pros: ['Thấy metrics và phát hiện lỗi sớm', 'Đuổi Gremlin khỏi vùng sáng', 'Rút ngắn thời gian chẩn đoán'],
    cons: ['Tốn điện và công chăm sóc', 'Không phủ hết thì có điểm mù', 'Quá nhiều cảnh báo gây alert fatigue'],
    real: 'Prometheus (metrics), Grafana (dashboard), OpenTelemetry (traces) và ELK stack (logs) là bộ công cụ observability phổ biến.',
    tryIt: 'Deploy lên một App nằm ngoài vùng sáng và để một đêm trôi qua; xem Gremlin và lỗi ẩn.',
    see: ['concept-observability', 'inc-baddeploy', 'inc-leak', 'concept-health-checks']
  },
  {
    id: 'comp-turret',
    cat: 'component',
    title: 'Tháp tường lửa',
    summary: 'Lớp phòng thủ vật lý chống bot DDoS; chỉ là một lớp trong defence in depth.',
    body: `<p><b>Defence in depth</b> nghĩa là xếp nhiều lớp phòng thủ độc lập, vì không lớp nào hoàn hảo. Game có ba lớp chống DDoS:</p>
<ul>
<li><b>Tháp tường lửa</b>: bắn hạ bot vật lý trong tầm, giảm nguồn traffic độc hại từ gốc.</li>
<li><b>WAF</b> ở Gateway: chặn ~95% request độc hại còn lọt qua.</li>
<li><b>Rate limit</b>: lưới an toàn cuối, loại bỏ cả lớp hợp lệ tương ứng — hiệu quả nhưng làm đau user thật.</li>
</ul>
<p>Mỗi lớp có điểm yếu riêng (tầm, 5% lọt WAF, chi phí user), nhưng xếp chồng thì xác suất lọt qua cả ba rất nhỏ. Tháp không thay được Gateway và cần được đặt gần luồng bot đến. Đừng đợi sự cố mới xây: DDoS leo thang theo mùa Đông.</p>`,
    pros: ['Giết bot từ nguồn', 'Bổ sung cho WAF và rate limit', 'Giảm tải độc hại trước khi vào hệ thống'],
    cons: ['Phủ giới hạn theo tầm bắn', 'Tốn tài nguyên để chế và duy trì', 'Không thay thế được WAF/rate limit'],
    real: 'Cloudflare, AWS Shield và Akamai kết hợp mitigation ở mạng, WAF ở ứng dụng và rate limiting — chính là defence in depth.',
    tryIt: 'Thử chặn DDoS chỉ với từng lớp một (tháp / WAF / rate limit), rồi bật cả ba và so % lỗi.',
    see: ['comp-gateway', 'inc-ddos', 'concept-load-shedding', 'concept-blast-radius']
  },

  // ---------------- Concepts ----------------
  {
    id: 'concept-slo',
    cat: 'concept',
    title: 'SLI, SLO và Error Budget',
    summary: 'SLO là lời hứa đo được về chất lượng; error budget là lượng lỗi bạn được phép "tiêu".',
    body: `<p><b>SLI</b> là số đo (tỷ lệ thành công, p99 latency). <b>SLO</b> là mục tiêu trên SLI đó. <b>Error budget</b> = 100% − SLO: lượng lỗi chấp nhận được; còn budget thì được ship nhanh, hết budget thì dồn sức cho độ tin cậy.</p>
<p>Từng "số 9" rất khác nhau: 99% cho phép ~3,65 ngày down mỗi năm, 99,9% chỉ ~8,8 giờ, 99,99% chỉ ~53 phút. Mỗi số 9 thường đắt gấp nhiều lần vì cần dư thừa, failover và vận hành chặt hơn.</p>
<ul>
<li>SLO của game: <b>≥98,5% thành công</b> và <b>p99 ≤ 1500 ms</b>.</li>
<li>Cuối ngày, SLO đạt ≥92% thời gian → <b>+12% user</b> (Xuân +25%); 75–92% giữ nguyên; 50–75% −10%; &lt;50% −25%.</li>
</ul>
<p>Hãy xem budget là tiền: hết thì đừng deploy rủi ro hay chạy chaos thử nghiệm.</p>`,
    pros: ['Mục tiêu rõ ràng, đo được', 'Cân bằng tốc độ ra tính năng và độ ổn định', 'Căn cứ chung để ưu tiên'],
    cons: ['Chọn SLI sai thì đo đúng cái vô nghĩa', 'Mỗi số 9 thêm rất đắt', 'SLO quá cao làm chậm đổi mới'],
    real: 'Sách Site Reliability Engineering của Google định nghĩa SLI/SLO/error budget và dùng chúng để cân bằng tốc độ phát hành với độ tin cậy.',
    tryIt: 'Nhìn báo cáo ngày: tìm khoảng thời gian SLO tụt dưới 98,5% và đối chiếu với p99 ở đó.',
    see: ['concept-postmortem', 'concept-capacity-cost', 'concept-tail-latency', 'concept-observability']
  },
  {
    id: 'concept-utilization',
    cat: 'concept',
    title: 'Utilization và hàng đợi',
    summary: 'Độ trễ không tăng tuyến tính theo tải: nó bùng nổ khi utilization tiến gần 100%.',
    body: `<p>Với hàng đợi đơn giản M/M/1, thời gian phục vụ trung bình ∝ <code>1/(1−ρ)</code> (ρ = utilization). Ở ρ=50% là 2× base; ở 80% là 5×; ở 90% là 10×; ở 95% là 20×. Nên "đang chạy 90% CPU" là gần như đã sập về độ trễ.</p>
<p><b>Định luật Little</b>: <code>L = λ·W</code>. Số request đang ở trong hệ thống bằng tốc độ đến nhân với thời gian ở lại. Khi W tăng, L tăng theo: hàng đợi, kết nối, bộ nhớ phình ra, rồi timeout kéo theo retry làm λ tăng thêm — vòng xoáy.</p>
<ul>
<li>Game dùng độ trễ node = <code>base / (1 − min(ρ, 0.95)) + backlog/cap</code>.</li>
<li>ρ &gt; 1: backlog đầy và request bị <b>drop</b> (503).</li>
<li>Vì vậy giữ <b>headroom</b>: mục tiêu ~70–80%, không phải 100%.</li>
</ul>`,
    pros: ['Giải thích vì sao headroom là cần thiết', 'Dự đoán được khi nào hệ thống "bỗng" chậm', 'Giúp đặt ngưỡng autoscale'],
    cons: ['Mô hình M/M/1 là xấp xỉ', 'Chạy ở util thấp tốn tiền', 'Thực tế còn phụ thuộc phân phối thời gian phục vụ'],
    real: 'Định luật Little là định lý được chứng minh trong lý thuyết hàng đợi và dùng rộng rãi trong performance engineering.',
    tryIt: 'Tăng dần tải lên một App và ghi lại p99 ở util 50%, 80%, 95% để thấy đường cong gập.',
    see: ['concept-tail-latency', 'concept-autoscaling', 'concept-capacity-cost', 'inc-spike']
  },
  {
    id: 'concept-tail-latency',
    cat: 'concept',
    title: 'Tail latency (p50 vs p99)',
    summary: 'Trung bình che giấu những request chậm nhất; p99 mới là trải nghiệm thật của nhiều user.',
    body: `<p><b>p50</b> là trung vị: một nửa request nhanh hơn. <b>p99</b>: 1% chậm nhất. Phân phối độ trễ có đuôi dài nên p99 có thể gấp vài chục lần p50 dù trung bình trông ổn.</p>
<p><b>Fan-out khuếch đại đuôi</b>: nếu một request gọi N dịch vụ song song và chờ hết, xác suất gặp ít nhất một lần chậm là <code>1 − 0,99^N</code>. Với N=100, khoảng 63% request dính p99 của một thành phần.</p>
<ul>
<li>Game: p50 ≈ 0,7·mean, p99 ≈ 4,6·mean (đuôi mũ).</li>
<li>Timeout client 3 s: xác suất timeout = <code>exp(−3000/mean)</code>, nên mean tăng nhẹ làm timeout tăng vọt.</li>
<li>SLO yêu cầu <b>p99 ≤ 1500 ms</b>, không phải trung bình.</li>
</ul>
<p>Giảm đuôi: giữ util thấp, hedged request, timeout hợp lý, cache.</p>`,
    pros: ['Phản ánh trải nghiệm user thật', 'Phát hiện sớm sự suy giảm', 'Căn cứ tốt cho SLO'],
    cons: ['Đo p99 cần nhiều mẫu', 'Khó cải thiện hơn trung bình', 'Hedging/giảm đuôi tốn tài nguyên'],
    real: 'Bài "The Tail at Scale" của Jeff Dean và Luiz Barroso (Google, 2013) phân tích tail latency và hedged request ở hệ thống fan-out.',
    tryIt: 'So p50 với p99 trên dashboard khi util tăng từ 60% lên 90%.',
    see: ['concept-utilization', 'concept-slo', 'concept-observability', 'comp-cache']
  },
  {
    id: 'concept-scaling',
    cat: 'concept',
    title: 'Scale up vs scale out',
    summary: 'Vertical nâng cấu hình một node; horizontal thêm nhiều node, đòi hỏi stateless và có giới hạn riêng.',
    body: `<p><b>Vertical (scale up)</b>: dùng máy mạnh hơn. Đơn giản, không đổi kiến trúc, nhưng có trần phần cứng, giá tăng phi tuyến và thường cần downtime. Trong game, đổi tier App cần <b>reboot ~10 s</b>.</p>
<p><b>Horizontal (scale out)</b>: thêm nhiều node sau <b>Load Balancer</b>. Chịu lỗi tốt (N+1) và gần như không có trần, nhưng đòi hỏi <b>stateless</b>: state phải nằm ở DB/Cache chứ không trong tiến trình App.</p>
<ul>
<li>Scale out cho App rất dễ; scale out cho DB khó vì phải shard/replicate, và shard có <b>skew</b>.</li>
<li>Thêm node làm tăng độ phức tạp, điện, và áp lực lên DB phía sau (nút cổ chai dời xuống).</li>
<li>Luật Amdahl: phần tuần tự (DB leader) giới hạn tăng tốc tổng.</li>
</ul>`,
    pros: ['Scale out cho redundancy và gần như không trần', 'Scale up đơn giản', 'Autoscaler tự động hoá scale out'],
    cons: ['Scale up có trần và cần reboot', 'Scale out cần stateless và LB', 'Nút cổ chai dời sang DB'],
    real: 'Kubernetes Horizontal Pod Autoscaler tự thêm/bớt pod theo metrics; mô hình stateless "twelve-factor app" khuyến khích scale out.',
    tryIt: 'Chuyển monolith sang 3 App + LB, rồi xem DB trở thành nút cổ chai thế nào khi spike.',
    see: ['comp-lb', 'comp-app', 'concept-sharding', 'concept-autoscaling']
  },
  {
    id: 'concept-lb-algos',
    cat: 'concept',
    title: 'Thuật toán cân bằng tải',
    summary: 'Round-robin, least-connections và hash trade-off giữa đơn giản, công bằng và tính cục bộ.',
    body: `<p><b>Round-robin</b>: xoay vòng, không cần trạng thái, nhưng giả định mọi node và mọi request ngang nhau. Với <b>công suất không đồng đều</b> (heterogeneous), node yếu quá tải trong khi node mạnh còn rảnh.</p>
<p><b>Least-connections</b>: gửi tới node đang có ít việc nhất, tự thích nghi khi node chậm. Trong game, nó chia theo công suất còn trống.</p>
<p><b>Hash / sticky</b>: cùng key vào cùng node — tốt cho cache cục bộ và session. Nhược điểm: phân phối lệch (skew), hot key dồn vào một node, và thêm/bớt node làm đổi chỗ nhiều key. <b>Consistent hashing</b> chỉ di chuyển ~1/N key khi đổi số node, và virtual node làm đều hơn.</p>
<ul>
<li>Sự cố <b>hotkey</b> làm skew hash tăng: đổi sang Least-connections hoặc salt key.</li>
<li>Không có thuật toán tốt nhất, chỉ có thuật toán hợp workload.</li>
</ul>`,
    pros: ['Least-connections thích nghi với node không đồng đều', 'Hash cho tính cục bộ/cache', 'Round-robin đơn giản, dễ đoán'],
    cons: ['Round-robin bỏ qua sức mạnh khác nhau', 'Hash gây skew và hot key', 'Least-connections cần theo dõi trạng thái'],
    real: 'HAProxy cung cấp roundrobin, leastconn và các chế độ hash; consistent hashing được dùng trong Amazon Dynamo và Cassandra.',
    tryIt: 'Dùng 2 App khác tier, chạy Round-robin rồi Least-connections, so util hai node.',
    see: ['comp-lb', 'inc-hotkey', 'concept-sharding', 'concept-health-checks']
  },
  {
    id: 'concept-cache-ttl',
    cat: 'concept',
    title: 'TTL, độ cũ và invalidation',
    summary: 'TTL đổi độ tươi của dữ liệu lấy hit ratio; invalidation chính xác khó hơn vẻ ngoài.',
    body: `<p>TTL đặt thời gian sống của key. TTL dài → hit ratio cao, DB nhẹ, nhưng người dùng thấy dữ liệu cũ lâu hơn. TTL ngắn → dữ liệu tươi nhưng tải DB cao và nhiều lần hết hạn hơn.</p>
<ul>
<li>Game: TTL <b>10/30/60 s</b>. Chọn theo mức chịu được độ cũ của từng loại dữ liệu.</li>
<li><b>Jitter</b> cộng ngẫu nhiên vào TTL để key không hết hạn đồng loạt (tránh stampede).</li>
<li><b>Request coalescing</b> chỉ cho một request đi lấy dữ liệu mới, còn lại chờ.</li>
</ul>
<p><b>Invalidation</b> chủ động (xoá key khi ghi) nghe gọn nhưng dễ sai: race giữa ghi DB và xoá cache, nhiều bản cache, dữ liệu phái sinh. Câu đùa kinh điển: chỉ có hai việc khó trong khoa học máy tính là đặt tên và cache invalidation. TTL là lưới an toàn khi invalidation bỏ sót.</p>`,
    pros: ['TTL dài tăng hit và giảm tải DB', 'TTL đơn giản, tự dọn', 'Jitter/coalescing chặn stampede'],
    cons: ['TTL dài cho dữ liệu cũ', 'TTL ngắn giảm hit', 'Invalidation chủ động dễ sai'],
    real: 'Redis hỗ trợ TTL trên từng key; CDN như Cloudflare dùng Cache-Control max-age và purge để cân bằng độ cũ và hit ratio.',
    tryIt: 'Thử TTL 10 s rồi 60 s, ghi lại hit ratio và tải DB; sau đó thử có và không Jitter.',
    see: ['comp-cache', 'inc-stampede', 'concept-cold-start', 'comp-cdn']
  },
  {
    id: 'concept-replication',
    cat: 'concept',
    title: 'Replication: sync vs async',
    summary: 'Sync an toàn nhưng chậm và kém sẵn sàng; async nhanh nhưng có thể mất dữ liệu (RPO > 0).',
    body: `<p>Replication sao chép ghi từ leader sang replica. <b>Sync</b>: leader chỉ ack sau khi replica xác nhận — không mất dữ liệu khi leader chết (<b>RPO = 0</b>), nhưng ghi chậm hơn và <b>thất bại nếu replica không với tới</b>. Trong game, đây là hành vi CP.</p>
<p><b>Async</b>: leader ack ngay, sao chép sau. Nhanh và luôn nhận ghi, nhưng có <b>replication lag</b>: nếu leader chết, ghi chưa được sao chép sẽ <b>mất</b>. Replica cũng có thể đọc dữ liệu cũ.</p>
<ul>
<li><b>RPO</b> (recovery point objective): lượng dữ liệu tối đa chấp nhận mất; <b>RTO</b>: thời gian chấp nhận để khôi phục.</li>
<li>Trong game, lag tăng khi primary quá tải.</li>
<li>Async + failover tự động + partition → nguy cơ split-brain.</li>
</ul>
<p>Nhiều hệ thống dùng semi-sync: đợi ít nhất một replica, đệm giữa hai cực.</p>`,
    pros: ['Sync: không mất dữ liệu', 'Async: ghi nhanh, luôn nhận ghi', 'Replica phục vụ đọc và failover'],
    cons: ['Sync: chậm và ghi lỗi khi mất kết nối replica', 'Async: mất dữ liệu khi leader chết', 'Lag gây đọc dữ liệu cũ'],
    real: 'PostgreSQL hỗ trợ synchronous_commit và streaming replication async; MySQL có semi-synchronous replication.',
    tryIt: 'Gây partition giữa DB và Replica ở chế độ sync rồi async, xem ghi lỗi hay ghi tiếp.',
    see: ['comp-db', 'comp-replica', 'concept-cap', 'concept-durability', 'inc-partition']
  },
  {
    id: 'concept-cap',
    cat: 'concept',
    title: 'CAP và PACELC',
    summary: 'Khi mạng bị chia cắt bạn phải chọn nhất quán hoặc sẵn sàng; không partition vẫn phải đổi latency lấy consistency.',
    body: `<p><b>CAP</b>: khi có <b>partition</b> (mạng chia đôi — không thể tránh ở hệ phân tán), hệ thống chỉ giữ được một trong hai: <b>Consistency</b> (mọi đọc thấy ghi mới nhất) hoặc <b>Availability</b> (mọi request nhận phản hồi). Không phải "chọn 2 trong 3" tuỳ ý.</p>
<p><b>PACELC</b> bổ sung: nếu không partition (Else), vẫn phải chọn giữa <b>Latency</b> và <b>Consistency</b>. Sync replication chậm hơn nhưng nhất quán hơn.</p>
<ul>
<li><b>CP</b>: từ chối ghi khi không chắc — trong game là replication <b>sync</b>, hoặc failover <b>quorum</b> (cần đa số, ≥3 node).</li>
<li><b>AP</b>: tiếp tục nhận ghi — <b>async</b> + failover tự động; rủi ro hai leader, <b>split-brain</b>, mất dữ liệu khi nối lại.</li>
</ul>
<p>Không có lựa chọn đúng chung: thanh toán thường chọn CP, feed xã hội thường chọn AP.</p>`,
    pros: ['Khung tư duy rõ cho trade-off', 'CP bảo vệ tính đúng đắn', 'AP giữ dịch vụ phản hồi'],
    cons: ['CP từ chối request khi partition', 'AP có thể mất/xung đột dữ liệu', 'Dễ bị hiểu sai thành "chọn 2/3"'],
    real: 'Eric Brewer nêu CAP; Daniel Abadi đề xuất PACELC. Cassandra thường được xếp AP, còn etcd/ZooKeeper (Raft/Zab) thiên về CP.',
    tryIt: 'Cắt cáp (partition) khi sync + quorum, rồi khi async + auto failover; so mất dữ liệu và lỗi ghi.',
    see: ['concept-replication', 'concept-split-brain', 'inc-partition', 'comp-db']
  },
  {
    id: 'concept-sharding',
    cat: 'concept',
    title: 'Sharding (phân mảnh dữ liệu)',
    summary: 'Chia dữ liệu theo key để scale ghi, đổi lấy hot key, query chéo shard và nỗi đau resharding.',
    body: `<p>Sharding chia bảng thành các phần độc lập, mỗi shard giữ một tập key. Khác replica (cùng dữ liệu, scale đọc), shard scale được cả <b>ghi</b> và dung lượng.</p>
<ul>
<li>Game: <b>1–4 shards</b>, nhưng có <b>skew</b> nên 4 shard không cho 4× công suất.</li>
<li><b>Hot key / hot shard</b>: một key nóng dồn vào một shard; thêm shard không giúp. Giải pháp: cache, <b>key salting</b> (rải một key ra nhiều key), hoặc tách key nóng.</li>
<li><b>Consistent hashing</b> giảm lượng key phải di chuyển khi thêm/bớt shard (~1/N thay vì gần hết như hash mod N).</li>
</ul>
<p>Resharding là đau: di chuyển dữ liệu đang chạy, dual-write, đổi routing. Query và transaction chéo shard đắt hoặc không có. Nên chọn <b>shard key</b> cẩn thận ngay từ đầu, và chỉ shard khi replica + cache + tier không còn đủ.</p>`,
    pros: ['Scale ghi và dung lượng', 'Cô lập lỗi theo shard', 'Consistent hashing giảm di chuyển dữ liệu'],
    cons: ['Skew và hot key', 'Query/transaction chéo shard khó', 'Resharding đau và rủi ro'],
    real: 'Vitess shard MySQL (xuất phát từ YouTube); MongoDB và Cassandra có sharding/partitioning tích hợp qua shard key/partition key.',
    tryIt: 'Tăng DB từ 1 lên 4 shards khi có hotkey; để ý tải không chia đều, rồi bật key salting.',
    see: ['comp-db', 'inc-hotkey', 'concept-lb-algos', 'concept-scaling']
  },
  {
    id: 'concept-observability',
    cat: 'concept',
    title: 'Monitoring vs Observability',
    summary: 'Monitoring trả lời câu hỏi đã biết; observability cho phép hỏi câu hỏi mới về lỗi chưa từng thấy.',
    body: `<p><b>Monitoring</b> theo dõi những điều bạn đã dự đoán (CPU, lỗi) và báo khi vượt ngưỡng. <b>Observability</b> là khả năng suy ra trạng thái bên trong từ output (metrics, logs, traces) để tìm nguyên nhân những lỗi chưa dự đoán.</p>
<p>Bốn <b>golden signals</b> của Google SRE: <b>latency</b>, <b>traffic</b>, <b>errors</b>, <b>saturation</b>. Bắt đầu từ chúng cho mỗi dịch vụ.</p>
<ul>
<li>Game: chỉ thấy metrics trong <b>vùng sáng</b>; ngoài đó là điểm mù, Gremlin gặm ban đêm.</li>
<li><b>Alert fatigue</b>: quá nhiều cảnh báo thấp giá trị → người trực bỏ qua cảnh báo thật. Trong game, tỉnh táo thấp (&lt;30%) làm dashboard nhiễu và &lt;15% sinh "cảnh báo giả".</li>
<li>Cảnh báo tốt báo theo triệu chứng ảnh hưởng user và có hành động rõ ràng.</li>
</ul>`,
    pros: ['Rút ngắn MTTD/MTTR', 'Chẩn đoán được lỗi chưa từng thấy', 'Golden signals là điểm khởi đầu gọn'],
    cons: ['Tốn chi phí lưu trữ và vận hành', 'Quá nhiều cảnh báo gây alert fatigue', 'Điểm mù nếu coverage thiếu'],
    real: 'Prometheus, OpenTelemetry và Grafana là bộ công cụ phổ biến; sách Google SRE định nghĩa bốn golden signals.',
    tryIt: 'Đặt thêm một App ngoài vùng sáng, rồi so thời gian bạn phát hiện lỗi so với App trong vùng sáng.',
    see: ['comp-lantern', 'concept-postmortem', 'concept-health-checks', 'concept-complexity']
  },
  {
    id: 'concept-capacity-cost',
    cat: 'concept',
    title: 'Capacity planning và chi phí',
    summary: 'Headroom mua độ bền, nhưng mỗi tài nguyên dư là tiền; cần cân giữa hoá đơn và khả năng sống sót.',
    body: `<p>Capacity planning dự đoán tải tương lai và đảm bảo đủ tài nguyên. Nhắm công suất đúng bằng tải đỉnh nghĩa là hết <b>headroom</b>: độ trễ bùng nổ ở ~80% util và một node chết là sập.</p>
<ul>
<li>Game: tải thay đổi theo ngày (hoàng hôn ×1.25, đêm ×0.45) và mùa (Hè ×1.35). Thiết kế cho đỉnh hoàng hôn mùa Hè, không phải trung bình.</li>
<li><b>N+1</b>: dư đủ để mất một node vẫn chịu được tải.</li>
<li>Chi phí = <b>điện/nhiên liệu</b>: mỗi component thêm watt vào burn rate; autoscaler tiết kiệm bằng cách chỉ thêm khi cần nhưng cần 15 s khởi động.</li>
</ul>
<p>Over-provision tốn tiền; under-provision tốn user. Cloud cho phép co giãn nhưng không miễn phí và không tức thời — spike ×4 trong ~50 s nhanh hơn khả năng autoscale. Đo, dự báo, tải thử, rồi quyết định mức dư.</p>`,
    pros: ['Headroom giúp sống sót qua đỉnh', 'Dự báo tránh scale vội', 'Autoscaling cân chi phí'],
    cons: ['Dư công suất tốn tiền liên tục', 'Dự báo sai gây thiếu hoặc lãng phí', 'Autoscale có độ trễ khởi động'],
    real: 'AWS Auto Scaling và Kubernetes HPA/Cluster Autoscaler co giãn theo tải; Well-Architected Framework có trụ cột "Cost Optimization" và "Reliability" cần cân bằng.',
    tryIt: 'Giữ util ~60% mùa Hè so với ~90%; so burn rate nhiên liệu và kết quả khi spike đến.',
    see: ['concept-utilization', 'concept-autoscaling', 'comp-generator', 'inc-spike']
  },
  {
    id: 'concept-complexity',
    cat: 'concept',
    title: 'Độ phức tạp là một chi phí',
    summary: 'Mỗi component thêm tải nhận thức và gánh nặng vận hành; kiến trúc "xịn" không miễn phí.',
    body: `<p>Mỗi thành phần mới — Cache, Queue, Replica, shard — giải quyết một vấn đề nhưng thêm một thứ để cấu hình, giám sát, nâng cấp và gỡ lỗi, cùng các kiểu lỗi mới (stampede, lag, split-brain). Độ phức tạp tăng nhanh hơn số component vì số <i>tương tác</i> giữa chúng tăng theo.</p>
<ul>
<li>Game: <b>Tỉnh táo (sanity)</b> giảm theo số component và tuỳ chọn, chia cho số kỹ sư online. Tỉnh táo thấp → dashboard nhiễu, rồi "cảnh báo giả".</li>
<li><b>Runbook</b> biến việc xử lý sự cố thành quy trình có sẵn nên giảm tải nhận thức; chia sẻ trực với nhiều kỹ sư cũng vậy.</li>
<li><b>Microservices tax</b>: tách dịch vụ thêm network hop, retry, tracing, deploy riêng; đáng giá khi tổ chức/scale cần, đắt khi chưa cần.</li>
</ul>
<p>Hãy thêm component khi có nỗi đau đo được, và xoá thứ không còn dùng.</p>`,
    pros: ['Runbook giảm tải nhận thức', 'Đơn giản hơn thì dễ vận hành hơn', 'Tách dịch vụ cho phép đội độc lập'],
    cons: ['Mỗi component thêm kiểu lỗi mới', 'Tỉnh táo giảm khi hệ thống rối', 'Microservices thêm chi phí hạ tầng và quan sát'],
    real: 'Nhiều đội công bố việc quay lại monolith (modular) khi microservices quá đắt; Kubernetes là ví dụ nền tảng mạnh nhưng đòi hỏi vận hành đáng kể.',
    tryIt: 'Thêm Cache, Queue và Replica cùng lúc rồi để ý thanh Tỉnh táo; sau đó dùng Runbook để hồi.',
    see: ['comp-lantern', 'concept-observability', 'concept-postmortem', 'concept-chaos']
  },
  {
    id: 'concept-orchestration',
    cat: 'concept',
    title: 'Orchestration: desired state & self-healing',
    summary: 'Bạn khai báo trạng thái mong muốn, control plane liên tục đối chiếu và sửa cho thực tế khớp; đổi lại là một hệ thống phức tạp để vận hành.',
    body: `<p>Orchestrator (điển hình là Kubernetes) vận hành theo <b>reconciliation loop</b>: so sánh <i>desired state</i> ("chạy 3 bản sao image v2") với <i>actual state</i>, rồi hành động để thu hẹp khoảng cách — khởi động lại pod chết, thêm bản sao, thay phiên bản. Vòng lặp này là nền tảng của <b>self-healing</b>: người vận hành không cần can thiệp từng sự cố.</p>
<ul>
<li><b>Liveness</b> probe quyết định có restart container không; <b>readiness</b> probe quyết định có đưa traffic vào không. Bản mới không qua readiness thì rolling update dừng và có thể tự rollback.</li>
<li><b>HPA</b> (Horizontal Pod Autoscaler) thêm/bớt bản sao theo metric; <b>rolling update</b> thay từng bản sao nên gần như không downtime.</li>
<li><b>Control plane</b> (API server, scheduler, etcd) là một SPOF mới: nó không tự chữa mình. Workload đang chạy vẫn sống, nhưng không còn self-healing hay scale cho tới khi control plane quay lại.</li>
</ul>
<p>Trong game: Kubernetes Cluster nối tới các App đã cài Module Docker sẽ restart App crash sau ~6 s, scale bằng HPA (8 s khởi động, tối đa +6 instance) và rolling update chỉ ~1 s downtime, auto-rollback bản lỗi sau ~10 s. Cái giá là 4 W điện, độ phức tạp +6 và sức làm việc 0.4 mỗi request. Với một monolith nhỏ, đó là overkill: LB + Autoscaler + runbook thường đủ và rẻ hơn.</p>`,
    pros: ['Tự chữa lỗi, giảm phụ thuộc vào người trực', 'Autoscaling và rolling update có sẵn', 'Mô hình khai báo, lặp lại được'],
    cons: ['Control plane là SPOF mới và không tự chữa', 'Tăng mạnh độ phức tạp và chi phí vận hành', 'Overkill cho hệ thống nhỏ/monolith'],
    real: 'Kubernetes được Google mở mã nguồn năm 2014 và kế thừa từ hệ thống nội bộ Borg; vòng lặp reconciliation (controller) là mô hình cốt lõi của nó.',
    tryIt: 'Nối Kubernetes tới một App đã cài Module Docker, chạy crash và so thời gian hồi phục với một App chỉ có Restart thủ công; để ý thanh Tỉnh táo.',
    see: ['comp-k8s', 'comp-docker', 'concept-health-checks', 'concept-autoscaling', 'concept-spof', 'concept-complexity', 'concept-containers']
  },
  {
    id: 'concept-containers',
    cat: 'concept',
    title: 'Container: image bất biến & cô lập nhẹ',
    summary: 'Đóng gói app cùng phụ thuộc thành image bất biến chạy nhanh, nhất quán giữa mọi môi trường; nhẹ hơn VM nhưng không phải VM.',
    body: `<p>Một <b>container image</b> gói code, runtime và thư viện thành một khối <i>immutable</i>: cùng image chạy giống hệt ở máy dev, staging và production. Điều này loại bỏ lớp lỗi "<i>works on my machine</i>" do lệch môi trường (drift), và khiến rollback đơn giản là chạy lại image cũ.</p>
<ul>
<li><b>Khởi động nhanh</b>: container là một process được cô lập, không boot cả hệ điều hành nên start trong giây thay vì phút.</li>
<li><b>Cô lập bằng Linux namespaces + cgroups</b>: namespaces giới hạn những gì process nhìn thấy, cgroups giới hạn CPU/RAM nó dùng. Các container <b>chia sẻ kernel</b> của host, nên cô lập yếu hơn VM (có hypervisor riêng kernel).</li>
<li><b>Overhead nhỏ</b> nhưng không bằng 0: lớp runtime, networking overlay và quản lý image tốn một ít tài nguyên.</li>
</ul>
<p>Trong game: Module Docker giảm một nửa thời gian reboot/restart của App, hạ xác suất deploy lỗi từ 30% xuống 12% (Backend Dev: 12% → 5%), đổi lấy -4% công suất và độ phức tạp +1. Nó cũng là điều kiện để Kubernetes quản lý App.</p>`,
    pros: ['Môi trường nhất quán, bớt lỗi do drift', 'Khởi động và restart nhanh', 'Đóng gói và rollback đơn giản'],
    cons: ['Chia sẻ kernel nên cô lập yếu hơn VM', 'Overhead runtime nhỏ nhưng có thật', 'Thêm công đoạn build/registry/bảo mật image'],
    real: 'Docker được mở mã nguồn năm 2013 và phổ biến hoá container; cô lập dựa trên Linux namespaces và cgroups.',
    tryIt: 'Cài Module Docker lên một App rồi chạy crash/restart và so thời gian reboot; thử deploy nhiều lần để thấy tỉ lệ bản lỗi giảm.',
    see: ['comp-docker', 'comp-k8s', 'concept-orchestration', 'inc-baddeploy', 'concept-blast-radius']
  }
];
