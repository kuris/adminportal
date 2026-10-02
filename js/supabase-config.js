/* ============================================================
   통합 관리자 포털 Supabase 설정 (supabase-config.js)

   - 15개 서비스와 동일한 Supabase 프로젝트를 사용합니다.
   - 다른 서비스와 세션이 섞이지 않도록 storageKey 를 포털 전용으로 분리합니다.
     (도메인이 admin.chatgpts.kr 로 달라 어차피 세션은 공유되지 않습니다)
   ============================================================ */

window.SUPABASE_URL = 'https://ybhiznlelnpwaicyoifa.supabase.co';
window.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_H4gFRiLEjE8h8s_EX4tKzg__ZKpsBR1';
window.SUPABASE_AUTH_STORAGE_KEY = 'sb-admin-portal-auth-token';
