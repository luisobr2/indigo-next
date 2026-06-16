import { redirect } from "next/navigation";

/**
 * Root route. The panel has no public landing page — send everyone to the
 * dashboard. Unauthenticated users are bounced to /login by the proxy /
 * the (app) session gate. (Was the default create-next-app boilerplate.)
 */
export default function Home() {
  redirect("/dashboard");
}
