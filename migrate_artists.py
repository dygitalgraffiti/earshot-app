#!/usr/bin/env python3
"""
Migration script to update artist names for existing posts using improved parsing logic.
Run this once after deploying the new app.py with improved artist extraction.

Usage:
    python migrate_artists.py
"""

import sys
import os

# Add the current directory to the path so we can import from app.py
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import app, db, Post, parse_track_url

def migrate_artists():
    """Update artist names for all existing posts."""
    with app.app_context():
        # Get all posts
        posts = Post.query.all()
        total = len(posts)
        updated = 0
        failed = 0
        skipped = 0
        
        print(f"Found {total} posts to process...")
        print("-" * 60)
        
        for i, post in enumerate(posts, 1):
            try:
                # Re-parse the URL with improved logic
                platform, info = parse_track_url(post.url)
                
                if not info:
                    print(f"[{i}/{total}] ❌ Failed to parse: {post.url[:50]}...")
                    failed += 1
                    continue
                
                # Check if we should update
                new_artist = info.get('artist', 'Unknown Artist')
                new_title = info.get('title', post.title)
                new_thumbnail = info.get('thumbnail', post.thumbnail)
                
                # Only update if:
                # 1. New artist is not "Unknown Artist" AND different from current
                # 2. OR current artist is "Unknown Artist" and we found something better
                should_update = False
                changes = []
                
                if new_artist != 'Unknown Artist' and new_artist != post.artist:
                    should_update = True
                    changes.append(f"artist: '{post.artist}' → '{new_artist}'")
                    post.artist = new_artist
                
                if new_title != post.title:
                    should_update = True
                    changes.append(f"title: '{post.title}' → '{new_title}'")
                    post.title = new_title
                
                if new_thumbnail != post.thumbnail:
                    should_update = True
                    changes.append("thumbnail updated")
                    post.thumbnail = new_thumbnail
                
                if should_update:
                    db.session.commit()
                    print(f"[{i}/{total}] ✅ Updated post #{post.id}: {', '.join(changes)}")
                    updated += 1
                else:
                    print(f"[{i}/{total}] ⏭️  Skipped post #{post.id} (no changes needed)")
                    skipped += 1
                    
            except Exception as e:
                print(f"[{i}/{total}] ❌ Error processing post #{post.id}: {e}")
                db.session.rollback()
                failed += 1
                continue
        
        print("-" * 60)
        print(f"Migration complete!")
        print(f"  ✅ Updated: {updated}")
        print(f"  ⏭️  Skipped: {skipped}")
        print(f"  ❌ Failed: {failed}")
        print(f"  📊 Total: {total}")

if __name__ == '__main__':
    print("=" * 60)
    print("Artist Migration Script")
    print("=" * 60)
    print()
    
    response = input("This will update artist names for all existing posts. Continue? (yes/no): ")
    if response.lower() not in ['yes', 'y']:
        print("Migration cancelled.")
        sys.exit(0)
    
    print()
    migrate_artists()

