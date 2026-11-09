# PayPal payment flow

The mobile app calls NearPay's authenticated API to create and capture PayPal Orders. PayPal credentials stay on the server in `server/.env`; the client receives only an order ID and approval URL.

The matched recipient ID is temporary and the displayed PayPal reference is masked. The server resolves the recipient's encrypted PayPal seller email, creates the order, then verifies the order, recipient, amount, currency, payer ownership, and approval status with PayPal before capture. A browser redirect or mobile callback is never treated as proof of payment. The payer reviews the recipient and amount, approves through PayPal, and can resume the return flow in the app if deep linking does not happen automatically.

PayPal Sandbox credentials can authenticate the API while seller-directed checkout remains subject to eligible seller setup and any required PayPal multiparty approval. Do not represent Sandbox credential success as proof that a recipient can receive a payment.
