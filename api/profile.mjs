import accountCore from "../server/account-core.cjs";

export default function handler(request, response) {
  const query = String(request.url || "").split("?")[1] || "";
  request.url = `/api/profile${query ? `?${query}` : ""}`;
  return accountCore.createAccountHandler()(request, response);
}
