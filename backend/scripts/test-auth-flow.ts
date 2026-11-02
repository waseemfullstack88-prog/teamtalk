async function run() {
  const BASE = 'http://localhost:4000/api';
  console.log('--- 1. Requesting Registration OTP ---');
  const res1 = await fetch(`${BASE}/auth/register/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'dr.bashir@starfleet.org', deviceId: 'pixel8-dev-12345678' }),
  });
  const data1 = await res1.json();
  console.log('Send OTP status:', res1.status, data1);
  if (!res1.ok) throw new Error('Send OTP failed');

  console.log('--- 2. Verifying OTP and Creating Account (Setting Username & Password) ---');
  const res2 = await fetch(`${BASE}/auth/register/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'dr.bashir@starfleet.org',
      code: data1.devOtp,
      displayName: 'Dr. Julian Bashir',
      password: 'ChiefMedicalOfficer!2026',
      deviceId: 'pixel8-dev-12345678',
      deviceName: 'Pixel 8 Pro Primary Phone',
    }),
  });
  const data2 = await res2.json();
  console.log('Verify OTP status:', res2.status, 'User:', data2.user?.displayName, 'IsCompanion:', data2.isCompanion);
  if (!res2.ok) throw new Error('Verify registration OTP failed');

  console.log('--- 3. Testing 1-Account-Per-Device Restriction ---');
  const res3 = await fetch(`${BASE}/auth/register/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'nurse@starfleet.org', deviceId: 'pixel8-dev-12345678' }),
  });
  const data3 = await res3.json();
  console.log('Second account attempt on same device status:', res3.status, data3);
  if (res3.status === 400 && data3.error?.message?.includes('Only 1 account')) {
    console.log('SUCCESS: Device restriction successfully blocked second account registration!');
  } else {
    throw new Error('Device restriction did not enforce 1 account per device');
  }

  console.log('--- 4. Testing Mandatory OTP on Every Sign-In ---');
  const res4 = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'dr.bashir@starfleet.org',
      password: 'ChiefMedicalOfficer!2026',
      deviceId: 'pixel8-dev-12345678',
    }),
  });
  const data4 = await res4.json();
  console.log('Login Step 1 status:', res4.status, 'requireOtp:', data4.requireOtp, 'devOtp:', data4.devOtp);
  if (!data4.requireOtp || !data4.loginToken) throw new Error('Mandatory OTP was not requested on login');

  const res5 = await fetch(`${BASE}/auth/login/verify-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      loginToken: data4.loginToken,
      code: data4.devOtp,
      deviceId: 'pixel8-dev-12345678',
    }),
  });
  const data5 = await res5.json();
  console.log('Login Step 2 (OTP Verify) status:', res5.status, 'Token length:', data5.accessToken?.length);
  if (!data5.accessToken) throw new Error('Login OTP verification failed');

  console.log('--- 5. Testing WhatsApp Web Companion Pairing ---');
  const res6 = await fetch(`${BASE}/auth/link/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const data6 = await res6.json();
  console.log('Pairing Link Generated:', data6.linkToken, 'QR URL length:', data6.qrDataUrl?.length);

  // Primary device approves pairing
  const res7 = await fetch(`${BASE}/auth/link/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data5.accessToken}`,
    },
    body: JSON.stringify({
      linkToken: data6.linkToken,
      deviceName: 'Chrome on MacOS (Web Companion)',
    }),
  });
  const data7 = await res7.json();
  console.log('Approve pairing status:', res7.status, data7);

  // Companion browser polls and claims session
  const res8 = await fetch(`${BASE}/auth/link/poll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkToken: data6.linkToken }),
  });
  const data8 = await res8.json();
  console.log('Companion poll status:', res8.status, 'Approved:', data8.approved, 'IsCompanion:', data8.isCompanion);
  if (!data8.approved || !data8.isCompanion) throw new Error('Companion linking failed');

  console.log('--- 6. Listing Linked Devices ---');
  const res9 = await fetch(`${BASE}/auth/linked-devices`, {
    headers: { Authorization: `Bearer ${data5.accessToken}` },
  });
  const data9 = await res9.json();
  console.log('Active Devices:', data9.devices.map((d: any) => ({ name: d.deviceName, isPrimary: d.isPrimary, isCompanion: d.isCompanion })));

  console.log('\n========================================');
  console.log('>>> ALL 6 VERIFICATION CHECKS PASSED 100%! <<<');
  console.log('========================================');
}

run().catch((e) => {
  console.error('Test failed:', e);
  process.exit(1);
});
