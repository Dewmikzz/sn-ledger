/**
 * WebAuthn platform biometric authentication (Fingerprint / TouchID / FaceID / Windows Hello).
 * Allows enrolled operators on trusted physical devices to unlock the ledger with 1 tap.
 */

export async function isBiometricsAvailable(): Promise<boolean> {
  if (typeof window === 'undefined' || !window.PublicKeyCredential) return false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
    }
  } catch {
    return false;
  }
  return false;
}

export function isBiometricsEnrolled(mode: string, operator: string): boolean {
  try {
    return Boolean(localStorage.getItem(`si-bio-${mode}-${operator}`));
  } catch {
    return false;
  }
}

export async function registerBiometrics(mode: string, operator: string, operatorName: string): Promise<boolean> {
  if (!(await isBiometricsAvailable())) {
    throw new Error('Biometric hardware is not available or supported on this device.');
  }

  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);
  const userId = new TextEncoder().encode(`si-${mode}-${operator}-${Date.now()}`);

  // Determine relying party ID (valid domain or localhost)
  let rpId = window.location.hostname;
  if (!rpId || rpId === '127.0.0.1') rpId = 'localhost';

  const creationOptions: CredentialCreationOptions = {
    publicKey: {
      challenge,
      rp: {
        name: 'Saman Indika Ledger',
        ...(rpId ? { id: rpId } : {})
      },
      user: {
        id: userId,
        name: `${operatorName} (${operator})`,
        displayName: operatorName,
      },
      pubKeyCredParams: [
        { alg: -7, type: 'public-key' },  // ES256
        { alg: -257, type: 'public-key' }, // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred',
      },
      timeout: 60000,
      attestation: 'none',
    },
  };

  const credential = await navigator.credentials.create(creationOptions) as (PublicKeyCredential & { rawId: ArrayBuffer }) | null;
  if (!credential) {
    throw new Error('Biometric registration was cancelled.');
  }

  const rawBytes = new Uint8Array(credential.rawId);
  const rawIdHex = Array.from(rawBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  localStorage.setItem(`si-bio-${mode}-${operator}`, JSON.stringify({
    id: credential.id,
    rawId: rawIdHex,
    registeredAt: new Date().toISOString(),
    operatorName
  }));

  return true;
}

export async function verifyBiometrics(mode: string, operator: string): Promise<boolean> {
  const stored = localStorage.getItem(`si-bio-${mode}-${operator}`);
  if (!stored) {
    throw new Error('Biometrics not set up for this profile yet. Please use your 6-digit PIN.');
  }

  const challenge = new Uint8Array(32);
  window.crypto.getRandomValues(challenge);

  const credData = JSON.parse(stored) as { id: string; rawId: string };
  const matches = credData.rawId.match(/.{1,2}/g);
  if (!matches) throw new Error('Invalid biometric registration.');
  const rawBytes = new Uint8Array(matches.map(byte => parseInt(byte, 16)));

  let rpId = window.location.hostname;
  if (!rpId || rpId === '127.0.0.1') rpId = 'localhost';

  const requestOptions: CredentialRequestOptions = {
    publicKey: {
      challenge,
      ...(rpId ? { rpId } : {}),
      allowCredentials: [
        {
          id: rawBytes,
          type: 'public-key',
          transports: ['internal'],
        },
      ],
      userVerification: 'required',
      timeout: 60000,
    },
  };

  const assertion = await navigator.credentials.get(requestOptions);
  return Boolean(assertion);
}

export function removeBiometrics(mode: string, operator: string): void {
  localStorage.removeItem(`si-bio-${mode}-${operator}`);
}
