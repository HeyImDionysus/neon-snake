import accountCore from "../server/account-core.cjs";

export default function handler(request, response) {
  request.url = "/api/activity/token";
  return accountCore.createAccountHandler()(request, response);
}
