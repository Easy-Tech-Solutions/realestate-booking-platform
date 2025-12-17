"""Apple SSO integration helpers.

This file provides placeholders for initiating Sign in with Apple.
"""

def get_apple_login_url(state: str) -> str:
    return f"https://appleid.apple.com/auth/authorize?state={state}"
