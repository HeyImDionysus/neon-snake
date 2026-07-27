import accountCore from "../../../server/account-core.cjs";

export default function handler(request, response) {
  request.url = "/api/auth/discord/start";
  return accountCore.createAccountHandler()(request, response);
}
