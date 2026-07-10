MultiSync
Real-Time Multi-Device Synchronized Speaker System

MultiSync is a real-time LAN-based synchronized music playback system that allows multiple devices to play the same audio in tight sync using WebSockets and Web Audio scheduling.

Designed as a full-stack project using React, Node.js, and Socket.io.

Features

Real-time synchronized playback across devices

Admin-controlled playback (play / pause / seek / next / prev)

Dynamic room creation (4-character code)

Username-based participant identification

Track upload system

Shared queue management

Drift-reduced audio scheduling using Web Audio API

Glass-style modern UI (Tailwind CSS)

LAN multi-device support

Automatic admin transfer if host disconnects

Tech Stack
Frontend

React 19

Vite

Tailwind CSS (v3)

Socket.io Client

Web Audio API

Backend

Node.js

Express

Socket.io

Multer (file uploads)

CORS

Project Structure
multi-phone-speaker-system/
│
├── client/        # React frontend
├── server/        # Express + Socket.io backend
├── .gitignore
└── README.md
Installation
1. Clone Repository
git clone https://github.com/YOUR_USERNAME/multi-phone-speaker-system.git
cd multi-phone-speaker-system
2. Install Backend
cd server
npm install
node index.js

Backend runs on:

http://localhost:5000
3. Install Frontend

Open new terminal:

cd client
npm install
npm run dev

Frontend runs on:

http://localhost:5173
Multi-Device Testing (LAN)

Start backend

Start frontend

Find your local IP:

ipconfig

Open on other device:

http://YOUR_LOCAL_IP:5173

All devices must be on same Wi-Fi network.

Sync Mechanism Overview

Server schedules playback start using timestamp

Clients calculate estimated server time

Audio is scheduled using AudioContext.currentTime

Playback offset is compensated

Small schedule-ahead buffer prevents jitter

Drift tolerance: ~50–120ms depending on network.

Security Notes

.env files are ignored

Uploaded files are ignored

No secrets stored in repository

LAN-only system (no public deployment configured)

Future Improvements

Persistent rooms (database)

WebRTC low-latency transport

Advanced NTP offset calibration

Production deployment (Docker)

Mobile PWA support

Cross-network sync

Author

Aadil Haque
Computer Engineering (KTU)

License

MIT License