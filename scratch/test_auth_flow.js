const BASE_URL = process.env.ASTERIM_URL || 'http://localhost:3000';

async function runAuthTests() {
  console.log('==================================================');
  console.log('🔑 Asterim Phase 2 Authentication & Account E2E Test');
  console.log(`Target Server: ${BASE_URL}`);
  console.log('==================================================\n');

  const testEmail = `test_${Date.now()}@asterim.dev`;
  const testPassword = 'SecurePassword123!';

  // 1. Test Registration
  console.log('1️⃣ Testing Registration (/api/v1/auth/register)...');
  const regRes = await fetch(`${BASE_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      fullName: 'Asterim QA Developer',
      clientType: 'browser',
    }),
  });

  const regData = await regRes.json();
  if (regRes.status !== 201) {
    console.error('❌ Registration failed:', regData);
    process.exit(1);
  }
  console.log('✅ Registration successful! User ID:', regData.user.id);
  console.log('   Access Token received (length):', regData.tokens.accessToken.length);

  const accessToken = regData.tokens.accessToken;

  // 2. Test Fetching Identity (/api/v1/auth/me)
  console.log('\n2️⃣ Testing Authenticated Identity (/api/v1/auth/me)...');
  const meRes = await fetch(`${BASE_URL}/api/v1/auth/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const meData = await meRes.json();
  if (!meRes.ok) {
    console.error('❌ Fetch identity failed:', meData);
    process.exit(1);
  }
  console.log('✅ Verified Identity:');
  console.log('   User Email:', meData.user.email);
  console.log('   Account ID:', meData.account.id);
  console.log('   Active Entitlements:', meData.entitlements.join(', '));

  // 3. Test Multi-Session API (/api/v1/sessions)
  console.log('\n3️⃣ Testing Session Management (/api/v1/sessions)...');
  const sesRes = await fetch(`${BASE_URL}/api/v1/sessions`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const sesData = await sesRes.json();
  if (!sesRes.ok) {
    console.error('❌ List sessions failed:', sesData);
    process.exit(1);
  }
  console.log('✅ Active Sessions Count:', sesData.sessions.length);

  // 4. Test Trusted Devices API (/api/v1/devices)
  console.log('\n4️⃣ Testing Trusted Devices (/api/v1/devices)...');
  const devRes = await fetch(`${BASE_URL}/api/v1/devices`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const devData = await devRes.json();
  if (!devRes.ok) {
    console.error('❌ List devices failed:', devData);
    process.exit(1);
  }
  console.log('✅ Trusted Devices Count:', devData.devices.length);

  // 5. Test Developer API Keys API (/api/v1/apikeys)
  console.log('\n5️⃣ Testing API Key Generation (/api/v1/apikeys)...');
  const keyRes = await fetch(`${BASE_URL}/api/v1/apikeys`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ keyName: 'CLI Pipeline Test Key' }),
  });

  const keyData = await keyRes.json();
  if (keyRes.status !== 201) {
    console.error('❌ API Key creation failed:', keyData);
    process.exit(1);
  }
  console.log('✅ Created API Key prefix:', keyData.apiKey.keyPrefix);
  console.log('   Raw Secret Key (one-time display):', keyData.rawSecretKey);

  // 6. Test Login (/api/v1/auth/login)
  console.log('\n6️⃣ Testing Login (/api/v1/auth/login)...');
  const loginRes = await fetch(`${BASE_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: testEmail,
      password: testPassword,
      clientType: 'desktop',
    }),
  });

  const loginData = await loginRes.json();
  if (!loginRes.ok) {
    console.error('❌ Login failed:', loginData);
    process.exit(1);
  }
  console.log('✅ Login successful! Session ID:', loginData.sessionId);

  console.log('\n==================================================');
  console.log('🎉 ALL AUTHENTICATION API TESTS PASSED 100%!');
  console.log('==================================================');
}

runAuthTests().catch(err => {
  console.error('Unhandled test error:', err);
  process.exit(1);
});
