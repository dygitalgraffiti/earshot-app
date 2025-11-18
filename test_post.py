#!/usr/bin/env python3
"""
Simple script to test posting songs via the API.
Use this to test the new artist extraction logic.
"""

import requests
import json
import sys

API_URL = 'https://earshot-app.onrender.com'

def login(username, password):
    """Login and get JWT token."""
    response = requests.post(
        f'{API_URL}/api/login',
        json={'username': username, 'password': password}
    )
    if response.status_code == 200:
        data = response.json()
        return data['token']
    else:
        print(f"Login failed: {response.json()}")
        return None

def post_song(token, url):
    """Post a song URL."""
    response = requests.post(
        f'{API_URL}/api/post',
        headers={
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        },
        json={'url': url}
    )
    return response

if __name__ == '__main__':
    print("=" * 60)
    print("Earshot Test Post Script")
    print("=" * 60)
    print()
    
    # Get credentials
    username = input("Username: ").strip()
    password = input("Password: ").strip()
    
    # Login
    print("\nLogging in...")
    token = login(username, password)
    if not token:
        print("❌ Login failed. Exiting.")
        sys.exit(1)
    
    print("✅ Logged in successfully!")
    print()
    
    # Get URL to post
    url = input("Enter song URL (Spotify/YouTube/Apple Music): ").strip()
    
    if not url:
        print("❌ No URL provided. Exiting.")
        sys.exit(1)
    
    # Post
    print(f"\nPosting: {url}")
    print("Processing...")
    
    response = post_song(token, url)
    
    if response.status_code == 200:
        data = response.json()
        print("✅ Posted successfully!")
        print(f"   Title: {data['post']['title']}")
    else:
        print(f"❌ Post failed: {response.status_code}")
        print(response.json())

