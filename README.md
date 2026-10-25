# Banking Data Sharing Simulator (Node + Express)

A customer decides which external apps can read which banking data.
Demonstrates API-based sharing, authentication, JWT, authorization and consent management.

## Run
```
npm install
npm start
```
Open http://localhost:3000 and sign in with **asha / bank123**.

## Flow
1. Customer signs in -> bank issues a customer JWT (1 hour).
2. An app clicks "Connect to bank" -> POST /api/authorize creates an access request.
3. Customer sees the request in the Consent manager and clicks Allow or Deny.
4. On Allow, the app collects a 5-minute JWT whose `scope` lists only the approved data.
5. The app calls the data APIs with `Authorization: Bearer <token>`.
6. Untick a box in the consent table to withdraw access. The next API call is refused.

## Endpoints
| Method | Path | Who | Purpose |
|---|---|---|---|
| POST | /api/login | customer | get customer JWT |
| GET | /api/apps | anyone | registered apps and the scopes they request |
| POST | /api/authorize | app | request access (returns requestId) |
| GET | /api/authorize/:id | app | poll status, receive token when approved |
| GET | /api/requests | customer | pending requests |
| POST | /api/requests/:id/decision | customer | allow or deny |
| GET / PUT | /api/consents | customer | view or change consent |
| GET | /api/data/balance | app token, scope `balance` | account balance |
| GET | /api/data/transactions | app token, scope `transactions` | transactions |
| GET / DELETE | /api/logs | customer | audit log |

## Authorization checks on /api/data/*
401 invalid, missing or expired token. 403 scope not in token. 403 customer consent withdrawn.

## Apps
- Expense Tracker: transactions
- Balance Checker: balance
- Financial Dashboard: balance + transactions

Data and consent are held in memory and reset when the server restarts.
Set JWT_SECRET in the environment for anything beyond a demo.
