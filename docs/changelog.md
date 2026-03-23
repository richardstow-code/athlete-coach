# Changelog

## 2026-03-22
- Fixed password reset flow: app now detects Supabase PASSWORD_RECOVERY
  event and shows a "Set new password" screen instead of ignoring the
  recovery token and rendering the login page.
