import { createAuthClient } from "better-auth/client";
import { anonymousClient } from "better-auth/client/plugins";

const auth = createAuthClient({ plugins: [anonymousClient()] });

export async function currentUser() {
  const session = await auth.getSession();
  return session.data?.user || null;
}
export async function updateName(name: string) {
  const result = await auth.updateUser({ name: name.trim().slice(0, 40) });
  if (result.error)
    throw new Error(result.error.message || "Your name couldn’t be saved.");
}
let establishing: Promise<void> | null = null;
export async function ensureIdentity() {
  if (!establishing) {
    const establish = async () => {
      const session = await auth.getSession();
      if (session.error)
        throw new Error(
          "Your session couldn’t be connected. Please try again.",
        );
      if (!session.data) {
        const result = await auth.signIn.anonymous();
        if (result.error) {
          // Another tab may have established the same browser session first.
          if (!(await auth.getSession()).data)
            throw new Error(
              result.error.message || "Could not connect your session.",
            );
        }
      }
    };
    // Serialize the first guest session across tabs sharing this origin.
    establishing = (
      navigator.locks
        ? navigator.locks.request("groups:identity", establish)
        : establish()
    ).finally(() => {
      establishing = null;
    });
  }
  return establishing;
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(
    path,
    body === undefined
      ? method === "POST"
        ? undefined
        : { method }
      : {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const data = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      new Error(data.message || "This request couldn’t be completed."),
      { status: response.status },
    );
  return data as T;
}
