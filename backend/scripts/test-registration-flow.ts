async function run() {
  const BASE = 'http://localhost:4000/api';

  console.log('--- 1. Testing Username Check ---');
  const resUserCheck1 = await fetch(`${BASE}/auth/check-username?username=nawaz_pro`);
  const dataUserCheck1 = await resUserCheck1.json();
  console.log('Username "nawaz_pro" check:', dataUserCheck1);
  if (!dataUserCheck1.available) throw new Error('Expected username nawaz_pro to be available');

  console.log('--- 2. Sending Registration OTP ---');
  const resOtp = await fetch(`${BASE}/auth/register/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' },
    body: JSON.stringify({ email: 'nawaz.test@company.io', deviceId: 'dev-laptop-nawaz-01' }),
  });
  const dataOtp = await resOtp.json();
  console.log('Send OTP status:', resOtp.status, 'devOtp:', dataOtp.devOtp);
  if (!dataOtp.ok || !dataOtp.devOtp) throw new Error('Failed to send registration OTP');

  console.log('--- 3. Verifying Registration OTP Step ---');
  const resVerifyStep = await fetch(`${BASE}/auth/register/verify-otp-step`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' },
    body: JSON.stringify({ email: 'nawaz.test@company.io', code: dataOtp.devOtp }),
  });
  const dataVerifyStep = await resVerifyStep.json();
  console.log('Verify OTP step status:', resVerifyStep.status, dataVerifyStep);
  if (!dataVerifyStep.verified) throw new Error('Failed to verify OTP step');

  console.log('--- 4. Completing Registration with Full Name, Username, 8+ Char Password, & Profile Picture ---');
  const resComplete = await fetch(`${BASE}/auth/register/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' },
    body: JSON.stringify({
      email: 'nawaz.test@company.io',
      code: dataOtp.devOtp,
      displayName: 'Muhammad Nawaz',
      username: 'nawaz_pro',
      password: 'SecurePassword!2026',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150',
      deviceId: 'dev-laptop-nawaz-01',
      deviceName: 'Windows 11 Workstation',
    }),
  });
  const dataComplete = await resComplete.json();
  console.log('Complete registration status:', resComplete.status, 'User:', dataComplete.user?.displayName, 'Username:', dataComplete.user?.username, 'Avatar:', !!dataComplete.user?.avatarUrl);
  if (!dataComplete.accessToken || dataComplete.user?.username !== 'nawaz_pro') {
    throw new Error('Registration complete failed');
  }

  console.log('--- 5. Verifying Username is Now Taken ---');
  const resUserCheck2 = await fetch(`${BASE}/auth/check-username?username=nawaz_pro`);
  const dataUserCheck2 = await resUserCheck2.json();
  console.log('Re-check username "nawaz_pro":', dataUserCheck2);
  if (dataUserCheck2.available) throw new Error('Expected username nawaz_pro to be unavailable now');

  console.log('--- 6. Testing Login Using USERNAME (not email) ---');
  const resLoginUser = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' },
    body: JSON.stringify({
      identifier: 'nawaz_pro',
      password: 'SecurePassword!2026',
      deviceId: 'dev-laptop-nawaz-01',
    }),
  });
  const dataLoginUser = await resLoginUser.json();
  console.log('Login with username status:', resLoginUser.status, 'requireOtp:', dataLoginUser.requireOtp, 'devOtp:', dataLoginUser.devOtp);
  if (!dataLoginUser.requireOtp || !dataLoginUser.loginToken) throw new Error('Username login failed to trigger OTP');

  console.log('--- 7. Verifying Login OTP ---');
  const resVerifyLogin = await fetch(`${BASE}/auth/login/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' },
    body: JSON.stringify({
      loginToken: dataLoginUser.loginToken,
      code: dataLoginUser.devOtp,
      deviceId: 'dev-laptop-nawaz-01',
    }),
  });
  const dataVerifyLogin = await resVerifyLogin.json();
  console.log('Login OTP verified status:', resVerifyLogin.status, 'Access token length:', dataVerifyLogin.accessToken?.length);
  if (!dataVerifyLogin.accessToken) throw new Error('Login OTP verification failed');

  console.log('--- 8. Testing Login Using EMAIL ---');
  const resLoginEmail = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5174' },
    body: JSON.stringify({
      identifier: 'nawaz.test@company.io',
      password: 'SecurePassword!2026',
      deviceId: 'dev-laptop-nawaz-01',
    }),
  });
  const dataLoginEmail = await resLoginEmail.json();
  console.log('Login with email status:', resLoginEmail.status, 'requireOtp:', dataLoginEmail.requireOtp);
  if (!dataLoginEmail.requireOtp) throw new Error('Email login failed to trigger OTP');

  console.log('\n======================================================');
  console.log('>>> COMPLETE REGISTRATION & LOGIN SYSTEM VERIFIED 100% <<<');
  console.log('======================================================');
}

run().catch((e) => {
  console.error('Test error:', e);
  process.exit(1);
});
