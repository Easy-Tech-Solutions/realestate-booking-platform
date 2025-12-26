"""Google SSO integration helpers.

This file provides placeholders for initiating OAuth and handling callbacks.
Use `social-auth-app-django` or direct Google OAuth flows.
"""

def get_google_login_url(state: str) -> str:
    # Return a constructed Google OAuth URL for frontend redirection
    return f"https://accounts.google.com/o/oauth2/v2/auth?state={state}"
