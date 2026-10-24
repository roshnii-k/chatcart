"""Synthetic deterministic-parser examples for manual API exploration."""

EXAMPLES = [
    {
        "label": "complete order",
        "message": "I need 3 chocolate cakes at ₹500 each for tomorrow. Deliver to Rose Villa, Thrissur.",
    },
    {
        "label": "missing details",
        "message": "I need 2 pies.",
    },
    {
        "label": "possible duplicate",
        "message": "I need 3 chocolate cakes at ₹500 each for tomorrow. Deliver to Rose Villa, Thrissur.",
    },
    {
        "label": "customer correction",
        "message": "Correction for order 11111111-1111-4111-8111-111111111111: change quantity to 2",
    },
]
