# PANDUAN SLIDE PRESENTASI RESMI
## PERANCANGAN KEBUTUHAN & ARSITEKTUR SISTEM OPENTASK
### Panduan Tayangan & Naskah Presenter (Slide-by-Slide Talking Points)

Dokumen ini disusun untuk memandu jalannya presentasi di hadapan Dosen Penguji, Stakeholder, atau Klien. Materi disajikan secara profesional, berfokus pada **Nilai Bisnis**, **Metodologi Rekayasa Kebutuhan**, **Arsitektur Sistem Terdistribusi**, dan **Kualitas Perangkat Lunak** tanpa menampilkan baris *source code*.

---

## SLIDE 1: JUDUL & PENGENALAN TIM

### Tampilan Visual Slide:
- **Judul Utama**: OPENTASK — Intelligent Agile Project Management Platform
- **Sub-judul**: Perancangan Kebutuhan Perangkat Lunak & Arsitektur Sistem Berorientasi Atribut Kualitas
- **Institusi**: Program Studi S1 Rekayasa Perangkat Lunak, Fakultas Informatika, Universitas Telkom
- **Tim Presenter**:
  - Evangelion Manuhutu (103022300164)

### Naskah Presenter (Talking Points):
> *"Selamat pagi Bapak/Ibu Dosen Penguji dan rekan-rekan sekalian. Hari ini kami akan mempresentasikan hasil perancangan sistem OpenTask, sebuah platform manajemen proyek tangkas (*Agile*) generasi baru yang mengintegrasikan kecerdasan buatan langsung ke dalam siklus kerja rekayasa perangkat lunak. Pada presentasi ini, kami akan membedah latar belakang masalah, hasil elisitasi kebutuhan, spesifikasi fungsional, serta taktik arsitektural yang menjamin atribut kualitas sistem kami."*

---

## SLIDE 2: PERNYATAAN MASALAH (PROBLEM STATEMENT)

### Tampilan Visual Slide:
- **Grafik / 4 Poin Kunci Masalah Industri**:
  1. **Bottleneck Code Review**: Waktu tunggu tinjauan PR lama dan sering tidak sesuai kriteria tugas awal.
  2. **Meeting Inefficacy**: Keputusan rapat teknis (*standup/planning*) sering hilang dan tidak menjadi tugas nyata.
  3. **Task Stagnation**: Tugas terbengkalai $>48$ jam tanpa disadari oleh manajer proyek.
  4. **Tool Fragmentation & Fatigue**: Tim kelelahan berpindah-pindah antar aplikasi terpisah yang lambat.

### Naskah Presenter (Talking Points):
> *"Berdasarkan studi kami terhadap tim pengembang perangkat lunak, tantangan terbesar saat ini bukan lagi sekadar menulis kode, melainkan inefisiensi alur kolaborasi. Survei empiris kami menunjukkan lebih dari 80% pengembang mengalami bottleneck saat menunggu review Pull Request. Selain itu, lebih dari 70% notulensi rapat sprint planning tidak sempat diubah menjadi tiket kerja terstruktur, dan tugas yang mengalami kendala teknis sering kali tersembunyi hingga akhir sprint. Inilah masalah mendasar yang diselesaikan oleh OpenTask."*

---

## SLIDE 3: SOLUSI INOVATIF & PROPOSISI NILAI (VALUE PROPOSITION)

### Tampilan Visual Slide:
- **Diagram 4 Pilar Solusi OpenTask**:
  - 📋 **Interactive Kanban Board**: Manajemen visual berkecepatan tinggi dengan estetika *Neo-Brutalist*.
  - 🤖 **Automated AI PR Reviewer**: Validasi otomatis kesesuaian *diff* kode terhadap kriteria tugas via AI.
  - 🎙️ **Meeting Intelligence**: Ekstraksi instan ringkasan rapat, keputusan, dan tugas aksi dari transkrip.
  - 📡 **Stagnation Radar & Auto-Reallocation**: Deteksi proaktif tugas mandek dan saran pengalihan beban kerja.

### Naskah Presenter (Talking Points):
> *"OpenTask hadir sebagai platform terpadu yang memadukan manajemen proyek visual dengan otomatisasi AI secara native. Kami tidak hanya menyediakan papan Kanban, tetapi juga menghubungkannya langsung dengan repositori GitHub dan mesin kecerdasan buatan. Setiap kali kode diajukan, AI langsung memverifikasi apakah kriteria tugas telah terpenuhi. Saat rapat selesai, notulensi langsung berubah menjadi tugas baru, dan jika ada tugas yang menganggur, radar kami akan segera memperingatkan tim."*

---

## SLIDE 4: ARSITEKTUR KONSEPTUAL SISTEM (C4 CONTAINER MODEL)

### Tampilan Visual Slide:
- **Diagram C4 Container (Tingkat Tinggi)**:
  - **Client Tier**: Web SPA interaktif dengan tema ganda (Dark/Light).
  - **API Gateway Tier**: Reverse proxy dengan pengamanan SSL & mitigasi CORS.
  - **Core Business Tier**: Layanan API nir-status (*Stateless*) berkinerja tinggi berbasis runtime non-blocking.
  - **Dedicated Background Engine**: Pekerja mandiri untuk evaluasi AI dan radar pemantauan berkala.
  - **Persistence Tier**: Klaster basis data relasional dengan kolam koneksi teroptimasi.
  - **External Ecosystem**: GitHub Webhooks, Google Gemini AI, Telegram Bot, dan Web Push VAPID.

### Naskah Presenter (Talking Points):
> *"Dari sudut pandang arsitektur, kami memisahkan alur transaksi pengguna dari tugas komputasi berat. Permintaan pengguna untuk melihat dan memindahkan kartu tugas dilayani secara instan oleh Core API Gateway. Sementara itu, analisis kecerdasan buatan dan pemindaian tugas berkala didelegasikan ke Dedicated Background Engine yang berjalan di latar belakang. Pemisahan ini menjamin antarmuka pengguna tidak akan pernah mengalami freeze meskipun sistem sedang mengevaluasi kode berskala besar."*

---

## SLIDE 5: ALUR KERJA CERDAS: AUTOMATED AI PR REVIEW

### Tampilan Visual Slide:
- **Diagram Sequence Alur Evaluasi PR**:
  1. Pengembang melakukan *push* kode dan membuka *Pull Request* di GitHub.
  2. GitHub Webhook mengirimkan notifikasi peristiwa ke OpenTask.
  3. Sistem memetakan PR ke tiket tugas yang sesuai.
  4. AI menganalisis *code diff* terhadap *acceptance criteria* tugas.
  5. AI mengeluarkan vonis (*PASS/FAIL*), skor kelengkapan (0–100%), dan saran perbaikan.
  6. Sistem mengeposkan komentar ulasan otomatis langsung di halaman PR GitHub.
  7. Pengembang menerima notifikasi instan di Telegram dan browser.

### Naskah Presenter (Talking Points):
> *"Inilah salah satu pembeda utama OpenTask. Pengembang tidak perlu lagi menunggu berhari-hari hanya untuk mengetahui apakah format kodenya sudah sesuai kebutuhan tugas. Dalam waktu kurang dari 8 detik setelah PR dibuka, AI telah membedah perbedaan kode, mencocokkannya dengan kriteria penerimaan tugas, dan langsung meninggalkan komentar ulasan resmi di GitHub. Hasilnya, saat reviewer manusia meninjau, mereka sudah memegang laporan validasi awal yang komprehensif."*

---

## SLIDE 6: METODOLOGI ELISITASI & MODEL KANO

### Tampilan Visual Slide:
- **Tabel Klasifikasi Model Kano**:
  - **Must Have (Dasar)**: Autentikasi GitHub, CRUD Project/Task, Papan Kanban, Penjaminan Presisi ID 64-bit (*SafeId*).
  - **Satisfier (Kinerja)**: Evaluasi AI pada PR, Konversi Action Items Rapat, Notifikasi Multi-Kanal (Telegram/Push), Dasbor Beban Kerja.
  - **Delighter (Inovatif)**: Stagnation Radar dengan rekomendasi pengalihan tugas otomatis, Bot kehadiran rapat mandiri, Skor kelengkapan kode 0–100%.

### Naskah Presenter (Talking Points):
> *"Dalam merumuskan kebutuhan perangkat lunak, kami mengombinasikan studi komparasi terhadap Jira dan Linear, penyebaran kuesioner kepada 65 praktisi, serta wawancara mendalam. Seluruh temuan kebutuhan disintesis menggunakan Model Kano. Fitur papan tugas dan integritas data numerik kami posisikan sebagai 'Must Have'. Kemampuan evaluasi AI dan notifikasi instan menjadi 'Satisfier' peningkat performa tim. Dan fitur radar stagnasi otomatis menjadi 'Delighter' yang memberikan keunggulan kompetitif unik bagi OpenTask."*

---

## SLIDE 7: SPESIFIKASI KEBUTUHAN FUNGSIONAL UTAMA

### Tampilan Visual Slide:
- **Sorotan Matriks Kebutuhan (20 Functional Requirements)**:
  - `REQ-01 s.d. REQ-06`: Manajemen Proyek, Kolom Alur, Tiket Tugas, dan Penjaminan Integritas SafeId.
  - `REQ-07 s.d. REQ-09`: Integrasi Repositori GitHub dan Otomasi Evaluasi AI PR.
  - `REQ-10 s.d. REQ-12`: Meeting Intelligence (Sintesis MoM, Konversi Tugas, Bot Pertemuan).
  - `REQ-13 s.d. REQ-16`: Stagnation Radar, Realokasi Cerdas, Web Push, dan Peringatan Telegram.
  - `REQ-17 s.d. REQ-20`: Manajemen Kunci AI Mandiri, Dasbor Analisis, Aksesibilitas Tema Ganda, dan Pemantauan Kesehatan Server.

### Naskah Presenter (Talking Points):
> *"Kami telah memformulasikan 20 butir Kebutuhan Fungsional formal yang mencakup seluruh siklus manajemen proyek. Setiap kebutuhan memiliki kriteria keberhasilan yang terukur secara kuantitatif. Sebagai contoh, REQ-06 secara khusus mewajibkan seluruh pengidentifikasi data berskala besar diserialisasikan ke format string khusus untuk mengeliminasi risiko pemotongan angka pada browser klien, sedangkan REQ-10 memastikan proses ekstraksi transkrip rapat menjadi tugas terstruktur selesai dalam waktu di bawah 5 detik."*

---

## SLIDE 8: UTILITY TREE & PRIORITAS ATRIBUT KUALITAS (ASR)

### Tampilan Visual Slide:
- **Diagram Utility Tree Kualitas**:
  - **Performance (High, High)**: Latensi respons API $\le 120\text{ ms}$, Throughput evaluasi AI $\le 8\text{ detik}$.
  - **Security (High, High)**: Otorisasi berbasis peran (RBAC), Anti-IDOR, Isolasi Kunci API AI.
  - **Availability (High, Medium)**: Target ketersediaan 99.9%, Pemulihan koneksi mandiri $\le 3\text{ detik}$.
  - **Interoperability (High, Medium)**: Ingesti webhook GitHub real-time, Standar Push VAPID RFC 8292.
  - **Maintainability & Usability (Medium, Medium)**: Keamanan tipe statis, Kontras tema ganda WCAG 2.1 AA.

### Naskah Presenter (Talking Points):
> *"Mengacu pada metodologi Software Engineering Institute (SEI), kami menyusun Utility Tree untuk memetakan Kebutuhan Signifikan Arsitektur (ASR). Dua atribut dengan prioritas tertinggi adalah Kinerja (*Performance*) dan Keamanan (*Security*). Kami menetapkan standar kualitas kuantitatif yang ketat: latensi API papan tugas tidak boleh melebihi 120 milidetik, sementara isolasi kredensial proyek dan integritas data numerik harus terlindungi 100% tanpa kompromi."*

---

## SLIDE 9: SKENARIO KUALITAS FORMAL (SEI 6-ELEMENT STANDARD)

### Tampilan Visual Slide:
- **Tabel 3 Skenario Kunci (Contoh Format SEI)**:
  - **Skenario Kinerja**: Beban $>200$ tugas $\rightarrow$ Respons API $\le 120\text{ ms}$, Animasi 60 FPS stabil.
  - **Skenario Keamanan**: Percobaan manipulasi data lintas proyek $\rightarrow$ Ditolak HTTP 403 dalam $\le 25\text{ ms}$.
  - **Skenario Ketersediaan**: Gangguan koneksi basis data $\rightarrow$ Pemulihan mandiri kolam koneksi $\le 3\text{ detik}$.

### Naskah Presenter (Talking Points):
> *"Setiap atribut kualitas kami uji menggunakan skenario formal 6 elemen standar SEI: mulai dari Sumber Stimulus, Stimulus, Artefak, Kondisi Lingkungan, Respons, hingga Ukuran Respons yang terukur. Pada skenario keamanan misalnya, ketika terjadi upaya manipulasi parameter tugas lintas organisasi, gerbang otorisasi RBAC kami memvalidasi keanggotaan pengguna dan menolak permintaan secara instan dalam 25 milidetik dengan tingkat kebocoran data nol."*

---

## SLIDE 10: TAKTIK ARSITEKTURAL (SEI ARCHITECTURAL TACTICS)

### Tampilan Visual Slide:
- **Peta Taktik Desain**:
  - ⚡ **Performance Tactics**: *Manage Resource Demand* via pemrosesan asinkron non-blocking, *Connection Pooling Reuse*.
  - 🛡️ **Security Tactics**: *Restrict Access via RBAC*, *Data Integrity Enforcement* (SafeId 64-bit), *Secret Masking*.
  - 🔄 **Availability Tactics**: *Fault Detection & Reconnection*, *Worker Decoupling* (isolasi error AI pihak ketiga).
  - 🌐 **Interoperability Tactics**: Kepatuhan protokol terbuka Web Push VAPID dan penanganan webhook standar.

### Naskah Presenter (Talking Points):
> *"Untuk memenuhi target kualitas tersebut, kami menerapkan taktik arsitektur formal. Pada taktik ketersediaan, kami mengadopsi 'Worker Decoupling': jika layanan AI pihak ketiga mengalami gangguan jaringan atau rate-limit, kegagalan tersebut diisolasi sepenuhnya pada antrean latar belakang sehingga operasional papan tugas tetap berjalan normal. Pada taktik kinerja, kami menggunakan koneksi persisten yang efisien untuk meminimalkan beban pembuatan koneksi ke basis data."*

---

## SLIDE 11: ANALISIS TRADE-OFF ARSITEKTUR

### Tampilan Visual Slide:
- **Matriks Keputusan & Kompromi Arsitektur**:
  - *Keputusan 1*: Pemrosesan Asinkron Latar Belakang $\rightarrow$ **Untung**: Kinerja & Uptime tinggi $\leftrightarrow$ **Beban**: Kompleksitas sinkronisasi status.
  - *Keputusan 2*: Serialisasi String untuk Identitas 64-bit $\rightarrow$ **Untung**: Integritas data mutlak $\leftrightarrow$ **Beban**: Sedikit konversi teks tipis.
  - *Keputusan 3*: Desain Neo-Brutalist Bebas Efek Blur $\rightarrow$ **Untung**: Render sangat cepat & kontras tinggi $\leftrightarrow$ **Beban**: Gaya visual tajam yang khas.

### Naskah Presenter (Talking Points):
> *"Tidak ada arsitektur yang sempurna tanpa kompromi. Kami secara sadar mengevaluasi trade-off dari setiap keputusan desain. Sebagai contoh, pemilihan serialisasi teks untuk identitas 64-bit membawa konsekuensi konversi string tipis, namun hal ini memberikan jaminan mutlak bahwa data tugas tidak akan pernah tertukar atau rusak akibat pembulatan floating point di peramban pengguna. Begitu pula pendekatan visual Neo-Brutalist yang menghilangkan efek blur berat, menghasilkan pemuatan halaman yang jauh lebih cepat dan ramah performa GPU."*

---

## SLIDE 12: PENGALAMAN PENGGUNA & AKSESIBILITAS TEMA GANDA

### Tampilan Visual Slide:
- **Poin Keunggulan Antarmuka (UI/UX & DevX)**:
  - Filosofi *Neo-Brutalist*: Garis batas kontras tinggi (*hard borders*), bayangan tegas (*hard offset shadows*), tipografi teknis yang tegas.
  - Aksesibilitas Universal: Rasio kontras teks memenuhi standar **WCAG 2.1 Level AA ($\ge 4.5:1$)**.
  - Dual-Theme Seamless Switch: Beralih instan antara mode Gelap (*Dark*) dan Terang (*Light*) dalam waktu $\le 50\text{ ms}$ tanpa kedipan layar (*zero flickering*).

### Naskah Presenter (Talking Points):
> *"Dari sisi pengalaman pengguna, OpenTask mengadopsi bahasa visual Neo-Brutalist. Kami mengeliminasi dekorasi yang tidak perlu dan mengedepankan keterbacaan serta ketegasan status. Kami mengaudit kontras visual secara ketat sehingga pada mode terang maupun gelap, teks dan indikator tugas tetap memiliki kontras di atas 4.5 banding 1 sesuai rekomendasi standar aksesibilitas internasional WCAG 2.1 AA."*

---

## SLIDE 13: KESIMPULAN & TANYA JAWAB

### Tampilan Visual Slide:
- **Rangkuman Nilai Strategis**:
  1. OpenTask memecahkan masalah nyata *code review bottleneck*, kehilangan hasil rapat, dan tugas mangkrak.
  2. Kebutuhan sistem dirancang komprehensif (20 Kebutuhan Fungsional & Matriks Non-Fungsional ISO 25010).
  3. Arsitektur tangguh berbasis taktik SEI dengan target kinerja latensi $\le 120\text{ ms}$ dan ketersediaan 99.9%.
- **Sesi Tanya Jawab**: *"Terima Kasih — Kami Siap Menerima Pertanyaan dan Masukan"*

### Naskah Presenter (Talking Points):
> *"Sebagai kesimpulan, OpenTask bukan sekadar papan tugas biasa, melainkan platform kolaborasi cerdas yang mengotomatisasi pekerjaan repetitif pengembang melalui kecerdasan buatan. Melalui perancangan kebutuhan yang matang dan arsitektur berorientasi atribut kualitas, OpenTask siap memberikan pengalaman kerja yang tangkas, aman, dan berkinerja tinggi. Sekian presentasi dari kelompok kami, kami membuka sesi tanya jawab untuk bapak/ibu dosen penguji. Terima kasih."*
