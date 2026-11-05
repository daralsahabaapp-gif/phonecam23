# PhoneCam

موبايل = كاميرا، موبايل تاني = شاشة مشاهدة. البث عبر WebRTC (مفيش تخزين).

## تشغيل محلي
npm install && npm start   # http://localhost:3000
(للتجربة من موبايل لازم HTTPS: استخدم `npx cloudflared tunnel --url http://localhost:3000` أو ngrok)

## نشر (Render / Railway / Fly)
- Build: npm install | Start: npm start  → بتاخد HTTPS تلقائي.

## الاتصال من أي شبكة (مهم)
STUN وحده مش كفاية مع شبكات 4G. أضف TURN عبر متغير البيئة ICE_SERVERS:
ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":"turn:YOUR_TURN_HOST:443?transport=tcp","username":"USER","credential":"PASS"}]'
خيارات: Metered.ca (فيه خطة مجانية) أو coturn على VPS.
