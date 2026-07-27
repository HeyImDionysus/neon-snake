import accountCore from "../server/account-core.cjs";

export default function handler(request, response) {
  request.url = "/api/realtime-ticket";
  return accountCore.createAccountHandler()(request, response);
}
