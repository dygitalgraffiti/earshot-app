# app.py – FINAL VERSION (profiles + case-insensitivity + first discover)

import os
import re
import random
import yt_dlp
import requests
from datetime import datetime
from urllib.parse import urlparse

from flask import (
    Flask, render_template, request, session, redirect,
    url_for, flash, jsonify, abort, Response
)
from flask_jwt_extended import (
    JWTManager,
    create_access_token,
    jwt_required,
    get_jwt_identity,
    verify_jwt_in_request,
)
from flask_sqlalchemy import SQLAlchemy
from flask_cors import CORS
from sqlalchemy import func, text
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
CORS(app, origins=["*"])

app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'earshot-secret-key-2025')
app.config['JWT_SECRET_KEY'] = 'earshot-mobile-secret-2025'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# ---------- DATABASE ----------
db_uri = (
    os.environ.get('DATABASE_URL', 'sqlite:///earshot.db')
    .replace('postgres://', 'postgresql+psycopg://', 1)
    .replace('postgresql://', 'postgresql+psycopg://', 1)
    + '?client_encoding=utf8'
)
app.config['SQLALCHEMY_DATABASE_URI'] = db_uri
db = SQLAlchemy(app)
jwt = JWTManager(app)

# ---------- MODELS ----------
# Define follow table first (before User class)
follow = db.Table(
    'follow',
    db.Column('follower_id', db.Integer, db.ForeignKey('user.id'), primary_key=True),
    db.Column('followed_id', db.Integer, db.ForeignKey('user.id'), primary_key=True)
)

class User(db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)   # stored lowercase
    password_hash = db.Column(db.String(200), nullable=True)  # Optional now
    device_id = db.Column(db.String(200), nullable=True, index=True)  # Device identifier
    twitter = db.Column(db.String(100), nullable=True)  # X/Twitter handle

    posts = db.relationship('Post', backref='author', lazy='dynamic')

    # Relationships
    following = db.relationship(
        'User', secondary=follow,
        primaryjoin=('follow.c.follower_id == user.c.id'),
        secondaryjoin=('follow.c.followed_id == user.c.id'),
        backref=db.backref('followers', lazy='dynamic'),
        lazy='dynamic'
    )

    def follow(self, user):
        if not self.is_following(user):
            self.following.append(user)

    def unfollow(self, user):
        if self.is_following(user):
            self.following.remove(user)

    def is_following(self, user):
        return self.following.filter(follow.c.followed_id == user.id).count() > 0

class Post(db.Model):
    __tablename__ = 'post'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    platform = db.Column(db.String(20))
    url = db.Column(db.String(300))
    title = db.Column(db.String(200))
    artist = db.Column(db.String(200))
    thumbnail = db.Column(db.String(300))
    embed_url = db.Column(db.String(300))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow, index=True)

# ---------- HELPERS ----------
def generate_username():
    """Generate a random 4-word username like 'purple-bear-3488'"""
    adjectives = ['purple', 'blue', 'green', 'red', 'yellow', 'orange', 'pink', 'black', 'white', 'gray',
                  'swift', 'bold', 'calm', 'bright', 'dark', 'cool', 'warm', 'sharp', 'smooth', 'rough']
    nouns = ['bear', 'wolf', 'eagle', 'tiger', 'lion', 'fox', 'hawk', 'shark', 'dragon', 'phoenix',
             'star', 'moon', 'sun', 'cloud', 'wave', 'storm', 'fire', 'ice', 'wind', 'stone']
    
    adj = random.choice(adjectives)
    noun = random.choice(nouns)
    num1 = random.randint(10, 99)
    num2 = random.randint(10, 99)
    
    username = f"{adj}-{noun}-{num1}{num2}"
    
    # Ensure uniqueness
    while User.query.filter(func.lower(User.username) == username.lower()).first():
        adj = random.choice(adjectives)
        noun = random.choice(nouns)
        num1 = random.randint(10, 99)
        num2 = random.randint(10, 99)
        username = f"{adj}-{noun}-{num1}{num2}"
    
    return username

def login_required(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return wrapper

# ---------- PARSERS ----------
def parse_track_url(url: str):
    url = url.strip()
    if 'spotify.com' in url:
        m = re.search(r'spotify\.com/track/([a-zA-Z0-9]+)', url)
        if not m: return None, None
        track_id = m.group(1)
        try:
            o = requests.get(f"https://open.spotify.com/oembed?url={url}").json()
            full = o['title']
            # Spotify oembed format: "Song Name · Artist Name"
            # Try multiple separators
            artist = 'Unknown Artist'
            song = full
            for sep in [' · ', ' - ', ' | ', ' — ', ' – ']:
                if sep in full:
                    parts = [x.strip() for x in full.split(sep, 1)]
                    if len(parts) == 2:
                        # Usually format is "Song · Artist", but sometimes "Artist - Song"
                        # Check which part looks more like an artist (shorter, or contains common artist indicators)
                        if len(parts[0]) < len(parts[1]) or 'feat' in parts[0].lower() or 'ft.' in parts[0].lower():
                            song, artist = parts[1], parts[0]
                        else:
                            song, artist = parts[0], parts[1]
                        break
            return 'spotify', {
                'title': song,
                'artist': artist,
                'thumbnail': o['thumbnail_url'],
                'embed_url': f"https://open.spotify.com/embed/track/{track_id}"
            }
        except Exception as e:
            print(f"Spotify parsing error: {e}")
            return None, None

    if any(x in url for x in ['youtube.com', 'youtu.be', 'music.youtube.com']):
        m = re.search(r'(?:v=|youtu\.be/|youtube\.com/embed/)([a-zA-Z0-9_-]+)', url)
        if not m: return None, None
        video_id = m.group(1)
        try:
            # Use yt-dlp to get better metadata (especially for YouTube Music)
            ydl_opts = {
                'quiet': True,
                'no_warnings': True,
                'extract_flat': False,
            }
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=False)
                title = info.get('title', 'Unknown Title')
                thumbnail = info.get('thumbnail') or f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"
                
                # Prioritize channel/uploader as artist (they're typically the artist)
                # Only use explicit 'artist' field if it exists, otherwise use channel/uploader
                artist = info.get('artist')  # Use explicit artist field if available
                if not artist:
                    # Use channel or uploader as artist (they're usually the artist)
                    artist = info.get('channel') or info.get('uploader') or 'Unknown Artist'
                
                # Only try parsing from title if we don't have a good artist name
                if artist == 'Unknown Artist':
                    for sep in [' - ', ' · ', ' | ', ' — ', ' – ', ' by ']:
                        if sep in title:
                            parts = [x.strip() for x in title.rsplit(sep, 1)]
                            if len(parts) == 2:
                                # Common formats: "Artist - Song" or "Song - Artist"
                                # Usually the first part is artist, but check length
                                if len(parts[0]) < 50:  # Artist names are usually shorter
                                    artist, title = parts[0], parts[1]
                                else:
                                    title, artist = parts[0], parts[1]
                                break
                
                return 'youtube', {
                    'title': title,
                    'artist': artist,
                    'thumbnail': thumbnail,
                    'embed_url': f"https://www.youtube.com/embed/{video_id}"
                }
        except Exception as e:
            print(f"YouTube parsing error: {e}")
            # Fallback to oembed if yt-dlp fails
            # Note: oembed doesn't provide channel info, so we parse from title
            try:
                o = requests.get(f"https://www.youtube.com/oembed?url={url}&format=json").json()
                full = o['title']
                # Try to get author/channel name from oembed (if available)
                artist = o.get('author_name') or 'Unknown Artist'
                
                # If we got author from oembed, use it; otherwise try parsing from title
                if artist == 'Unknown Artist':
                    for sep in [' - ', ' · ', ' | ', ' — ', ' – ']:
                        if sep in full:
                            parts = [x.strip() for x in full.rsplit(sep, 1)]
                            if len(parts) == 2:
                                if len(parts[0]) < 50:
                                    artist, full = parts[0], parts[1]
                                else:
                                    full, artist = parts[0], parts[1]
                                break
                
                return 'youtube', {
                    'title': full,
                    'artist': artist,
                    'thumbnail': o['thumbnail_url'],
                    'embed_url': f"https://www.youtube.com/embed/{video_id}"
                }
            except:
                return None, None

    if 'music.apple.com' in url:
        m = re.search(r'music\.apple\.com/[^/]+/song/(\d+)', url)
        if not m: return None, None
        song_id = m.group(1)
        try:
            data = requests.get(f"https://itunes.apple.com/lookup?id={song_id}&entity=song").json()
            if data['resultCount'] == 0: return None, None
            track = data['results'][0]
            thumb = track['artworkUrl100'].replace('100x100', '300x300')
            return 'apple', {
                'title': track['trackName'],
                'artist': track['artistName'],
                'thumbnail': thumb,
                'embed_url': url.replace('/song/', '/embed/song/')
            }
        except: return None, None

    return None, None

# ---------- ROUTES ----------
@app.route('/')
def index():
    posts = Post.query.order_by(Post.timestamp.desc()).limit(50).all()
    for p in posts:
        p.username = p.author.username if p.author else "[deleted]"
        p.is_mine = 'user_id' in session and p.user_id == session['user_id']
    return render_template('index.html', posts=posts)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username'].strip().lower()
        password = request.form['password']
        user = User.query.filter(func.lower(User.username) == username).first()
        if user and check_password_hash(user.password_hash, password):
            session['user_id'] = user.id
            session['username'] = user.username
            if request.is_json:
                token = create_access_token(identity=str(user.id))
                return jsonify({'success': True, 'token': token, 'user': {'id': user.id, 'username': user.username}})
            return redirect(url_for('index'))
        if request.is_json:
            return jsonify({'error': 'Invalid credentials'}), 401
        flash('Invalid credentials')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username'].strip().lower()
        password = request.form['password']
        if User.query.filter(func.lower(User.username) == username).first():
            flash('Username already taken')
            return render_template('register.html')
        new_user = User(
            username=username,
            password_hash=generate_password_hash(password)
        )
        db.session.add(new_user)
        db.session.commit()
        flash('Registered! Please log in.')
        return redirect(url_for('login'))
    return render_template('register.html')

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

# ---------- MOBILE API ----------
@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json()
    device_id = data.get('device_id', '').strip()
    username_input = data.get('username', '').strip()
    
    if not device_id:
        return jsonify({'error': 'Device ID required'}), 400
    
    # Check if user exists with this device_id
    user = User.query.filter_by(device_id=device_id).first()
    
    if user:
        # Existing user - update username if provided and different
        if username_input and username_input.lower() != user.username:
            new_username = username_input.lower()
            # Check if new username is taken
            if User.query.filter(func.lower(User.username) == new_username).filter(User.id != user.id).first():
                return jsonify({'error': 'Username already taken'}), 400
            user.username = new_username
            db.session.commit()
        
        token = create_access_token(identity=str(user.id))
        return jsonify({
            'success': True,
            'token': token,
            'user': {'id': user.id, 'username': user.username}
        })
    
    # New user - create account
    if username_input:
        username = username_input.lower()
        # Check if username is taken
        if User.query.filter(func.lower(User.username) == username).first():
            return jsonify({'error': 'Username already taken'}), 400
    else:
        # Generate random username
        username = generate_username()
    
    new_user = User(
        username=username,
        device_id=device_id,
        password_hash=None  # No password needed
    )
    db.session.add(new_user)
    db.session.commit()
    
    token = create_access_token(identity=str(new_user.id))
    return jsonify({
        'success': True,
        'token': token,
        'user': {'id': new_user.id, 'username': new_user.username}
    })

@app.route('/api/feed', methods=['GET'])
@jwt_required()
def api_feed():
    posts = Post.query.order_by(Post.timestamp.desc()).limit(100).all()
    feed = []
    for p in posts:
        feed.append({
            'id': p.id,
            'username': p.author.username if p.author else '[deleted]',
            'title': p.title,
            'artist': p.artist,
            'thumbnail': p.thumbnail,
            'url': p.url,
            'createdAt': p.timestamp.isoformat(),
        })
    return jsonify(feed)

@app.route('/api/post', methods=['POST'])
@jwt_required()
def api_post():
    user_id = get_jwt_identity()
    data = request.get_json()
    url = data.get('url', '').strip()
    platform, info = parse_track_url(url)
    if not info:
        return jsonify({'error': 'Unsupported URL'}), 400

    post = Post(
        user_id=user_id,
        url=url,
        title=info['title'],
        artist=info.get('artist'),
        thumbnail=info['thumbnail'],
        embed_url=info['embed_url'],
        platform=platform
    )
    db.session.add(post)
    db.session.commit()

    return jsonify({'success': True, 'post': {'id': post.id, 'title': post.title}})

# ---------- NEW: PROFILE + FOLLOW ----------
@app.route('/api/profile/<username>', methods=['GET'])
def api_profile(username):
    user = User.query.filter(func.lower(User.username) == username.lower()).first_or_404()
    posts = Post.query.filter_by(user_id=user.id).order_by(Post.timestamp.desc()).all()
    
    # Check if this is the current user's own profile (optional JWT)
    is_own_profile = False
    is_following = False
    try:
        verify_jwt_in_request(optional=True)
        current_user_id = get_jwt_identity()
        if current_user_id:
            current_user_id = int(current_user_id)
            is_own_profile = (current_user_id == user.id)
            if not is_own_profile:
                current_user = User.query.get(current_user_id)
                if current_user:
                    is_following = current_user.is_following(user)
    except:
        pass  # Not logged in or invalid token

    return jsonify({
        'user': {
            'id': user.id,
            'username': user.username,
            'twitter': user.twitter or '',
            'followers': user.followers.count(),
            'following': user.following.count(),
        },
        'is_own_profile': is_own_profile,
        'is_following': is_following,
        'posts': [{
            'id': p.id,
            'title': p.title,
            'artist': p.artist,
            'thumbnail': p.thumbnail,
            'url': p.url,
            'createdAt': p.timestamp.isoformat(),
            'is_first_discover': Post.query.filter_by(url=p.url).count() == 1
        } for p in posts]
    })

@app.route('/api/follow/<int:user_id>', methods=['POST'])
@jwt_required()
def api_follow(user_id):
    current_user = User.query.get(get_jwt_identity())
    target = User.query.get_or_404(user_id)
    if current_user.id == target.id:
        return jsonify({'error': 'Cannot follow self'}), 400

    if current_user.is_following(target):
        current_user.unfollow(target)
        action = 'unfollowed'
    else:
        current_user.follow(target)
        action = 'followed'
    db.session.commit()

    return jsonify({'action': action, 'followers': target.followers.count()})

# ---------- DELETE POST ----------
@app.route('/api/post/<int:post_id>', methods=['DELETE'])
@jwt_required()
def api_delete_post(post_id):
    """Delete a post. Only the post owner can delete their own posts."""
    current_user_id = int(get_jwt_identity())
    post = Post.query.get_or_404(post_id)
    
    # Check if the current user owns this post
    if post.user_id != current_user_id:
        return jsonify({'error': 'Unauthorized. You can only delete your own posts.'}), 403
    
    # Delete the post
    db.session.delete(post)
    db.session.commit()
    
    return jsonify({'success': True, 'message': 'Post deleted successfully'})

# ---------- UPDATE USERNAME ----------
@app.route('/api/profile/username', methods=['PUT'])
@jwt_required()
def api_update_username():
    """Update the current user's username."""
    current_user_id = int(get_jwt_identity())
    current_user = User.query.get_or_404(current_user_id)
    
    data = request.get_json()
    new_username = data.get('username', '').strip().lower()
    
    if not new_username:
        return jsonify({'error': 'Username is required'}), 400
    
    # Check if username is already taken by another user
    existing_user = User.query.filter(func.lower(User.username) == new_username).filter(User.id != current_user_id).first()
    if existing_user:
        return jsonify({'error': 'Username already taken'}), 400
    
    current_user.username = new_username
    db.session.commit()
    
    return jsonify({
        'success': True,
        'username': current_user.username
    })

# ---------- MIGRATION ENDPOINT (ONE-TIME USE) ----------
@app.route('/api/migrate-artists', methods=['POST'])
def migrate_artists_endpoint():
    """
    One-time migration endpoint to update artist names for existing posts.
    Requires a secret key to prevent unauthorized access.
    Call this once after deploying improved artist extraction logic.
    """
    # Simple security: require a secret key in the request
    secret_key = request.json.get('secret_key') if request.is_json else request.form.get('secret_key')
    expected_key = os.environ.get('MIGRATION_SECRET', 'earshot-migration-2025')
    
    if secret_key != expected_key:
        return jsonify({'error': 'Unauthorized. Secret key required.'}), 401
    
    try:
        posts = Post.query.all()
        total = len(posts)
        updated = 0
        failed = 0
        skipped = 0
        results = []
        
        for i, post in enumerate(posts, 1):
            try:
                platform, info = parse_track_url(post.url)
                
                if not info:
                    results.append(f"Failed to parse post #{post.id}")
                    failed += 1
                    continue
                
                new_artist = info.get('artist', 'Unknown Artist')
                new_title = info.get('title', post.title)
                new_thumbnail = info.get('thumbnail', post.thumbnail)
                
                should_update = False
                changes = []
                
                if new_artist != 'Unknown Artist' and new_artist != post.artist:
                    should_update = True
                    changes.append(f"artist: '{post.artist}' → '{new_artist}'")
                    post.artist = new_artist
                
                if new_title != post.title:
                    should_update = True
                    changes.append(f"title updated")
                    post.title = new_title
                
                if new_thumbnail != post.thumbnail:
                    should_update = True
                    changes.append("thumbnail updated")
                    post.thumbnail = new_thumbnail
                
                if should_update:
                    db.session.commit()
                    results.append(f"Updated post #{post.id}: {', '.join(changes)}")
                    updated += 1
                else:
                    skipped += 1
                    
            except Exception as e:
                results.append(f"Error processing post #{post.id}: {str(e)}")
                db.session.rollback()
                failed += 1
                continue
        
        return jsonify({
            'success': True,
            'summary': {
                'total': total,
                'updated': updated,
                'skipped': skipped,
                'failed': failed
            },
            'results': results[:50]  # Limit to first 50 results to avoid huge response
        })
        
    except Exception as e:
        return jsonify({'error': f'Migration failed: {str(e)}'}), 500

# ---------- RUN ----------
if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        print("Database tables ensured")
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)