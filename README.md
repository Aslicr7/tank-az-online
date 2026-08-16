# 🚀 TANK AZ ONLINE - GAME BẮN SÚNG XE TĂNG 2D MULTIPLAYER

Dự án game **Bắn súng xe tăng AZ Online** 2D góc nhìn từ trên xuống (Top Down), lấy cảm hứng từ tựa game huyền thoại **AZ (Tank Trouble trên Y8)**. Game chạy trực tiếp trên trình duyệt HTML5 Canvas, hỗ trợ chơi Chơi Đơn (vs Bot AI), Chơi Cùng Máy (2 người trên 1 bàn phím), Mạng LAN không cần Internet, và Multiplayer Online qua Socket.IO.

---

## 🌟 TÍNH NĂNG NỔI BẬT

1. **Cơ Chế Bắn Đạn Bật Tường (Ricochet Mechanics)**
   - Đạn bay tốc độ cao và nảy tường tối đa **3 lần** trước khi nổ.
   - Hiệu ứng tia lửa (spark particle) khi đạn chạm góc tường.
   - Bot AI cấp độ Khó có khả năng tính toán đường nảy đạn để bắn gián tiếp!

2. **Map Mê Cung Sinh Ngẫu Nhiên (Random Maze Generator)**
   - Sử dụng thuật toán *Recursive Backtracker* để sinh bản đồ ngẫu nhiên mỗi trận.
   - Có tường chắn, khoảng trống, đường vòng chiến thuật và điểm xuất phát (Spawn Points) cân bằng.

3. **Chế Độ Chơi Phong Phú**
   - **Offline Mode**: Chơi 1 người đấu với Bot AI hoặc 2 người chung bàn phím.
   - **Online / LAN Mode**: Hỗ trợ đấu Deathmatch, Team Battle (Đội Đỏ vs Đội Xanh) và Bot Battle.
   - Hỗ trợ điền tự động Bot AI với 3 mức độ: **Easy**, **Medium**, **Hard**.

4. **Hệ Thống 8 Vật Phẩm Chia Làm 3 Nhóm State**
   - **Nhóm 1 - ĐẠN (Chỉ kích hoạt 1 loại, nhặt đạn mới ghi đè đạn cũ, hiệu lực 10s - VIẾT HOA TOÀN BỘ)**:
     - 🔥 **ĐẠN SIÊU TỐC**: Tăng tốc độ bay từ 380 px/s lên 520 px/s (+37%).
     - 💣 **ĐẠN CỠ LỚN**: Nhân 3 lần bán kính đạn (5px ➔ 15px), spawn offset an toàn và bỏ qua va chạm với xe bắn trong 120ms đầu.
     - 🪃 **ĐẠN SIÊU NẢY**: Tăng số lần nảy tường từ 3 lên **10 lần nảy** với vệt xanh ngọc.
     - ⚡ **ĐẠN LASER**: Chùm tia laser tức thì (Instant Hit-scan) xuyên suốt đường thẳng.
   - **Nhóm 2 - HIỆU ỨNG (Timer độc lập, CỘNG DỒN SONG SONG ĐƯỢC VỚI NHAU, hiệu lực 10s - Viết Hoa Chữ Cái Đầu)**:
     - 🛡️ **Khiên Bảo Vệ**: Miễn nhiễm hoàn toàn trước mọi sát thương; đạn bay trúng xe sẽ **xuyên thẳng qua** mà không phát nổ hay cản trở.
     - ⚡ **Tăng Tốc Độ**: Tăng tốc độ di chuyển của xe tăng thêm +40% (x1.4 tốc độ gốc).
     - ⏱️ **Bắn Liên Tục**: Giảm 60% thời gian hồi đạn (cooldown chỉ còn 0.4s so với 1.0s gốc).
     * *Đang có buff Nhóm 2 mà nhặt thêm đồ khác thì KHÔNG bị mất timer cũ.*
   - **Nhóm 3 - NỘI TẠI (Tồn tại vĩnh viễn đến khi bị bắn trúng 1 lần - viết thường toàn bộ)**:
     - ❤️ **mạng phụ**: Đỡ hộ 1 phát đạn chí mạng cứu sống tại chỗ mà không bị tính death/trừ điểm. Kích hoạt xong thì biến mất.
   - *Cơ chế xuất hiện & tồn tại trên bản đồ*:
     - **Tần suất sinh**: Cứ mỗi **5 - 7 giây** sinh 1 vật phẩm ngẫu nhiên tại vị trí trống (tối đa 6 vật phẩm).
     - **Thời gian tồn tại**: Tự động biến mất sau **25 giây** nếu không ai nhặt.
     - **Hiển thị trực quan**: Format tên badge hiển thị phân cấp chuẩn theo 3 nhóm.

5. **Âm Thanh Procedural & Hiệu Ứng Đồ Họa**
   - Trình tổng hợp âm thanh sống động live bằng Web Audio API (không phụ thuộc file MP3 ngoài).
   - Hiệu ứng khói, tia lửa bắn, nổ hạt particle, vết xích xe tăng (Tread marks) và rung màn hình nhẹ (Camera Shake).

---

## 📁 CẤU TRÚC THƯ MỤC DỰ ÁN

```text
TankAZ/
├── client/                  # Mã nguồn giao diện Frontend
│   ├── index.html           # HTML5 Entry Point
│   ├── style.css            # Stylesheet Tailwind CSS & Custom UI
│   ├── game.js              # Khởi tạo Game Loop & Client Socket Engine
│   ├── player.js            # Render xe tăng, nòng súng, khiên & bảng tên
│   ├── bullet.js            # Render đạn, vệt đạn & hiệu ứng bật tường
│   ├── map.js               # Render mê cung, bóng tường & Power-ups
│   ├── ui.js                # Quản lý Menu, Modal, HUD Scoreboard, FPS/Ping
│   ├── effects.js           # Quản lý Particle hạt nổ, khói, vết xích & Rung màn hình
│   └── sound.js             # Bộ tổng hợp âm thanh Web Audio API
├── server/                  # Mã nguồn xử lý Backend Node.js
│   ├── server.js            # Khởi chạy Express HTTP & Socket.IO Server
│   ├── room.js              # Quản lý Room, Tick Rate (30Hz), Đồng bộ & Va chạm
│   ├── physics.js           # Engine vật lý, Sinh mê cung, Va chạm & Nảy đạn
│   └── bot.js               # AI Bot đường đi, Né đạn & Dự đoán góc bắn
├── server.ts                # Entry point chính chạy Node + Socket.IO server
├── package.json             # Danh sách dependencies & scripts
└── README.md                # Hướng dẫn cài đặt & vận hành dự án
```

---

## 🛠️ HƯỚNG DẪN CÀI ĐẶT & CHẠY SERVER

### 1. Yêu Cầu Hệ Thống
- **Node.js**: Phiên bản 18.0.0 trở lên.
- **NPM**: Phiên bản 8.0.0 trở lên.

### 2. Cài Đặt Dependencies
Mở Terminal tại thư mục gốc của dự án và chạy lệnh:
```bash
npm install
```

### 3. Chạy Server ở Chế Độ Development
```bash
npm run dev
```
Server sẽ chạy mặc định tại cổng **3000**: `http://localhost:3000`

### 4. Build Production & Chạy Server Production
```bash
npm run build
npm start
```

---

## 🌐 HƯỚNG DẪN CHƠI MẠNG LAN (KHÔNG CẦN INTERNET)

1. Kết nối máy chủ (Server) và các máy chơi (Client) vào **cùng một mạng Wi-Fi hoặc mạng dây LAN**.
2. Chạy server trên máy chủ: `npm start` hoặc `npm run dev`.
3. Kiểm tra địa chỉ IP nội bộ của máy chủ trong Terminal (ví dụ: `192.168.1.100`).
4. Các máy khác chỉ cần mở trình duyệt và truy cập theo cú pháp:
   ```text
   http://<IP_MAY_CHU>:3000
   ```
   *Ví dụ*: `http://192.168.1.100:3000`

---

## 🎮 HƯỚNG DẪN ĐIỀU KHIỂN GAME

### Người Chơi 1 (Online / Local P1):
- **Di chuyển xe tăng**: Phím `W`, `A`, `S`, `D` hoặc các phím Mũi Tên.
- **Bắn đạn**: Nhấp **Chuột Trái** hoặc phím **SPACE**.
---

## ⚙️ CÔNG NGHỆ BÊN TRONG

- **Frontend**: HTML5 Canvas API, ES6 Modules, Tailwind CSS.
- **Backend**: Node.js, Express, Socket.IO.
- **Đồng bộ Mạng**: Server Authoritative State với Tick Rate 30Hz, Client Frame Interpolation 60 FPS giúp di chuyển mượt mà không bị giật lag.
