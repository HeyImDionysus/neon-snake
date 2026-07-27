import accountCore from "../server/account-core.cjs";

export default function handler(request, response) {
  request.url = "/api/leaderboard";
  return accountCore.createAccountHandler()(request, response);
}
