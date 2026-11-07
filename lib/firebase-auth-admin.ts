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
  phone: string;
  email: string | null;
  emailVerified: boolean;
};

export async function verifyFirebaseIdentityToken(idToken: string, whatsappVerifiedPhone = ""): Promise<VerifiedFirebaseIdentity> {
  const decoded = await firebaseAuthAdmin().verifyIdToken(idToken, true);
  const firebasePhone = typeof decoded.phone_number === "string" ? decoded.phone_number : "";
  const phone = firebasePhone || whatsappVerifiedPhone;
  if (firebasePhone && whatsappVerifiedPhone && firebasePhone.replace(/[^0-9]/g, "") !== whatsappVerifiedPhone.replace(/[^0-9]/g, "")) {
    throw new Error("رقم الهاتف في هوية Firebase لا يطابق الرقم الموثّق عبر واتساب");
  }
  const provider = typeof decoded.firebase?.sign_in_provider === "string"
    ? decoded.firebase.sign_in_provider
    : "";
  if (!decoded.uid || !phone || !provider || provider === "anonymous") {
    throw new Error("يجب توثيق رقم الهاتف قبل متابعة تسجيل الدخول");
  }

  const normalizedProvider = provider === "google.com" || provider === "apple.com" || provider === "phone" || provider === "password"
    ? provider
    : "";
  if (!normalizedProvider) throw new Error("طريقة تسجيل الدخول غير مدعومة");

  return {
    uid: decoded.uid,
    provider: normalizedProvider,
    phone,
    email: typeof decoded.email === "string" ? decoded.email : null,
    emailVerified: decoded.email_verified === true,
  };
}
