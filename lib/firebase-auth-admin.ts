import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

/** Separate named Admin app keeps the existing FCM app and its configuration untouched. */
function firebaseAuthAdmin() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase Admin authentication is not configured");
  }

  const appName = "euro-cars-auth";
  const app = getApps().find((candidate) => candidate.name === appName)
    ?? initializeApp(
      { credential: cert({ projectId, clientEmail, privateKey }), projectId },
      appName,
    );
  return getAuth(app);
}

export type VerifiedFirebaseIdentity = {
  uid: string;
  provider: string;
  /** Empty until an SMS-verified phone is supplied or Firebase phone auth was used. */
  phone: string;
  email: string | null;
  emailVerified: boolean;
};

export async function verifyFirebaseIdentityToken(idToken: string, whatsappVerifiedPhone = ""): Promise<VerifiedFirebaseIdentity> {
  const decoded = await firebaseAuthAdmin().verifyIdToken(idToken, true);
  const firebasePhone = typeof decoded.phone_number === "string" ? decoded.phone_number : "";
  const phone = firebasePhone || whatsappVerifiedPhone;
  if (firebasePhone && whatsappVerifiedPhone &&
      firebasePhone.replace(/[^0-9]/g, "") !== whatsappVerifiedPhone.replace(/[^0-9]/g, "")) {
    throw new Error("رقم الهاتف في هوية Firebase لا يطابق الرقم الموثّق برمز الرسالة النصية");
  }

  const provider = typeof decoded.firebase?.sign_in_provider === "string"
    ? decoded.firebase.sign_in_provider
    : "";
  if (!decoded.uid || !provider || provider === "anonymous") {
    throw new Error("هوية تسجيل الدخول غير صالحة");
  }

  const normalizedProvider = provider === "google.com" || provider === "apple.com" ||
    provider === "phone" ? provider : "";
  if (!normalizedProvider) throw new Error("طريقة تسجيل الدخول غير مدعومة");

  return {
    uid: decoded.uid,
    provider: normalizedProvider,
    phone,
    email: typeof decoded.email === "string" ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
  };
}


/** Permanently removes a Firebase Auth account after the EURO deletion worker verifies its UID is not shared. */
export async function deleteFirebaseAuthUser(uid: string): Promise<void> {
  if (!uid || uid.length > 256) throw new Error("Invalid Firebase UID");
  try {
    await firebaseAuthAdmin().deleteUser(uid);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: unknown }).code)
      : "";
    if (code === "auth/user-not-found") return;
    throw error;
  }
}
