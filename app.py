# app.py
import os
import re
import yt_dlp
import requests
from datetime import datetime
from flask import (
    Flask, render_template, request, session, redirect,
    url_for, flash, jsonify, abort
)
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import UniqueConstraint
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=["*"])
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'earshot-secret-key-2025')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
# JWT Setup (for mobile app)
app.config['JWT_SECRET_KEY'] = 'earshot-mobile-secret-2025'
jwt = JWTManager(app)
# ---------- DATABASE ----------
db_uri = (
    os.environ.get('DATABASE_URL', 'sqlite:///earshot.db')
    .replace('postgres://', 'postgresql+psycopg://', 1)
    .replace('postgresql://', 'postgresql+psycopg://', 1)
    + '?client_encoding=utf8'
)
app.config['SQLALCHEMY_DATABASE_URI'] = db_uri
db = SQLAlchemy(app)

# ---------- MODELS ----------
class User(db.Model):
    __tablename__ = 'user'
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)   # plain-text for demo only!

    posts = db.relationship('Post', backref='author', lazy='dynamic')
    following = db.relationship(
        'Follow', foreign_keys='Follow.follower_id',
        backref='follower', lazy='dynamic')
    followers = db.relationship(
        'Follow', foreign_keys='Follow.followed_id',
        backref='followed', lazy='dynamic')

    def is_following(self, other_user):
        return self.following.filter_by(followed_id=other_user.id).first() is not None

class Follow(db.Model):
    __tablename__ = 'follow'
    id = db.Column(db.Integer, primary_key=True)
    follower_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    followed_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)

    __table_args__ = (UniqueConstraint('follower_id', 'followed_id', name='unique_follow'),)

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
# ---------------PARSE TEST ---------
import re
import requests

def parse_url(url):
    url = url.strip()
    if not url:
        return None

    # === YOUTUBE ===
    yt_match = re.search(r'(?:youtube\.com/watch\?v=|youtu\.be/|music\.youtube\.com/watch\?v=)([a-zA-Z0-9_-]+)', url)
    if yt_match:
        video_id = yt_match.group(1)
        try:
            oembed = requests.get(f"https://www.youtube.com/oembed?url={url}&format=json", timeout=5).json()
            full_title = oembed['title'].strip()

            # Smart split: try multiple patterns
            title = full_title
            artist = "Unknown Artist"

            patterns = [
                r'^(.+?)\s*[-–—·|]\s*(.+)$',           # Artist - Title
                r'^(.+?)\s*[:]\s*(.+)$',               # Artist: Title
                r'^(.+?)\s*\(\s*(.+?)\s*\)$',          # Title (Artist)
                r'^(.*?)\s+by\s+(.+)$',                # Title by Artist
            ]

            for pattern in patterns:
                m = re.match(pattern, full_title, re.IGNORECASE)
                if m:
                    if 'by' in pattern.lower():
                        title, artist = m.groups()
                    else:
                        artist, title = m.groups()
                    artist = artist.strip()
                    title = title.strip()
                    break

            return {
                'title': title or full_title,
                'artist': artist,
                'thumbnail': oembed['thumbnail_url'],
                'embed_url': f"https://www.youtube.com/embed/{video_id}",
                'platform': 'youtube'
            }
        except:
            pass

    # === SPOTIFY ===
    sp_match = re.search(r'spotify\.com/track/([a-zA-Z0-9]+)', url)
    if sp_match:
        track_id = sp_match.group(1)
        try:
            oembed = requests.get(f"https://open.spotify.com/oembed?url={url}", timeout=5).json()
            full = oembed['title']
            if ' · ' in full:
                song, artist = [x.strip() for x in full.split(' · ', 1)]
            else:
                song, artist = full, 'Unknown Artist'
            return {
                'title': song,
                'artist': artist,
                'thumbnail': oembed['thumbnail_url'],
                'embed_url': f"https://open.spotify.com/embed/track/{track_id}",
                'platform': 'spotify'
            }
        except:
            pass

    return None

# ---------- MEDIA PARSERS ----------
def _spotify(url):
    m = re.search(r'spotify\.com/track/([a-zA-Z0-9]+)', url)
    if not m: return None
    track_id = m.group(1)
    try:
        oembed = requests.get(f"https://open.spotify.com/oembed?url={url}").json()
        full = oembed['title']
        # Spotify format: "Song · Artist"
        if ' · ' in full:
            song, artist = [x.strip() for x in full.split(' · ', 1)]
        else:
            song, artist = full, 'Unknown Artist'
        return {
            'title': song,
            'artist': artist,
            'thumbnail': oembed['thumbnail_url'],
            'embed_url': f"https://open.spotify.com/embed/track/{track_id}"
        }
    except:
        return None

def _youtube(url):
    url = re.sub(r'music\.youtube\.com', 'youtube.com', url)
    m = re.search(r'youtube\.com/watch\?v=([a-zA-Z0-9_-]+)', url)
    if not m: return None
    video_id = m.group(1)
    try:
        o = requests.get(f"https://www.youtube.com/oembed?url={url}&format=json").json()
        full = o['title']
        # Try multiple separators
        for sep in [' - ', ' · ', ' | ', ' — ']:
            if sep in full:
                artist, title = [x.strip() for x in full.rsplit(sep, 1)]
                return {
                    'title': title or full,
                    'artist': artist or 'Unknown Artist',
                    'thumbnail': o['thumbnail_url'],
                    'embed_url': f"https://www.youtube.com/embed/{video_id}"
                }
        # Fallback
        return {
            'title': full,
            'artist': 'Unknown Artist',
            'thumbnail': o['thumbnail_url'],
            'embed_url': f"https://www.youtube.com/embed/{video_id}"
        }
    except:
        return {
            'title': 'YouTube Video',
            'artist': 'Unknown',
            'thumbnail': '',
            'embed_url': f"https://www.youtube.com/embed/{video_id}"
        }
def _apple(url):
    m = re.search(r'music\.apple\.com/[^/]+/song/(\d+)', url)
    if not m: return None
    song_id = m.group(1)
    try:
        data = requests.get(f"https://itunes.apple.com/lookup?id={song_id}&entity=song").json()
        if data['resultCount'] == 0: return None
        track = data['results'][0]
        thumb = track['artworkUrl100'].replace('100x100', '300x300')
        embed = url.replace('/song/', '/embed/song/')
        return {
            'title': track['trackName'],
            'artist': track['artistName'],
            'thumbnail': thumb,
            'embed_url': embed
        }
    except Exception:
        return None

def parse_track_url(url: str):
    url = url.strip()
    if 'spotify.com' in url:
        data = _spotify(url)
        return 'spotify', data
    if 'youtube.com' in url or 'youtu.be' in url or 'music.youtube.com' in url:
        data = _youtube(url)
        return 'youtube', data
    if 'music.apple.com' in url:
        data = _apple(url)
        return 'apple', data
    return None, None
from urllib.parse import urlparse

@app.template_filter('url_domain')
def url_domain(url):
    try:
        return urlparse(url).netloc.replace('www.', '')
    except:
        return url
# ---------- HELPERS ----------
def login_required(f):
    from functools import wraps
    @wraps(f)
    def wrapper(*args, **kwargs):
        if 'user_id' not in session:
            return redirect(url_for('login'))
        return f(*args, **kwargs)
    return wrapper

# ---------- ROUTES ----------

@app.route('/')
def index():
    posts = (
        Post.query
        .order_by(Post.timestamp.desc())
        .limit(50)
        .all()
    )
    for p in posts:
        p.username = p.author.username if p.author else "[deleted]"
        p.is_mine = 'user_id' in session and p.user_id == session['user_id']
    return render_template('index.html', posts=posts)
@app.route('/edit/<int:post_id>', methods=['GET', 'POST'])
@login_required
def edit_post(post_id):
    post = Post.query.get_or_404(post_id)
    if post.user_id != session['user_id']:
        abort(403)

    if request.method == 'POST':
        post.title = request.form['title'].strip() or post.title
        post.artist = request.form['artist'].strip() or post.artist
        db.session.commit()
        flash('Updated!')
        return redirect(url_for('index'))

    return render_template('edit_post.html', post=post)

@app.route('/feed/following')
@login_required
def feed_following():
    user = User.query.get(session['user_id'])
    followed_ids = [f.followed_id for f in user.following]
    followed_ids.append(user.id)
    posts = (
        Post.query
        .filter(Post.user_id.in_(followed_ids))
        .order_by(Post.timestamp.desc())
        .limit(50)
        .all()
    )
    for p in posts:
        p.username = p.author.username if p.author else "[deleted]"
        p.is_mine = 'user_id' in session and p.user_id == session['user_id']
    return render_template('feed.html', posts=posts, title="Following")

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = User.query.filter_by(username=username, password=password).first()
        if user:
            session['user_id'] = user.id
            session['username'] = user.username
            # JSON for AJAX, HTML redirect for normal form
            if request.is_json:
                return jsonify({'success': True, 'user_id': user.id, 'username': user.username})
            return redirect(url_for('index'))
        else:
            if request.is_json:
                return jsonify({'success': False, 'error': 'Invalid credentials'}), 401
            flash('Invalid credentials')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if not username or not password:
            return jsonify({'success': False, 'error': 'Both fields required'}), 400
        if User.query.filter_by(username=username).first():
            return jsonify({'success': False, 'error': 'Username taken'}), 400

        user = User(username=username, password=password)
        db.session.add(user)
        db.session.commit()
        session['user_id'] = user.id
        session['username'] = user.username
        if request.is_json:
            return jsonify({'success': True, 'user_id': user.id, 'username': user.username})
        return redirect(url_for('index'))
    return render_template('register.html')

@app.route('/logout')
def logout():
    session.pop('user_id', None)
    session.pop('username', None)
    flash('Logged out.')
    return redirect(url_for('login'))

# ---------- POST ----------
@app.route('/post', methods=['GET', 'POST'])
@login_required
def post():
    if request.method == 'POST':
        url = request.form['url'].strip()
        if not url:
            flash('URL required')
            return redirect(url_for('post'))

        info = parse_url(url)
        if not info:
            flash('Unsupported or invalid URL')
            return redirect(url_for('post'))

        new_post = Post(
            user_id=session['user_id'],
            url=url,
            title=info['title'],
            artist=info.get('artist'),
            thumbnail=info['thumbnail'],
            embed_url=info['embed_url'],
            platform=info['platform']
        )
        db.session.add(new_post)
        db.session.commit()
        flash('Posted!')
        return redirect(url_for('index'))

    return render_template('post_form.html')

# ---------- PROFILE ----------
@app.route('/profile/<username>')
def profile(username):
    user = User.query.filter_by(username=username).first_or_404()
    # Posts by this user
    posts = user.posts.order_by(Post.timestamp.desc()).limit(20).all()
    # Follow stats
    following = user.following.count()
    followers = user.followers.count()
    is_following = False
    if 'user_id' in session:
        current = User.query.get(session['user_id'])
        is_following = current.is_following(user)

    return render_template(
        'profile.html',
        profile_user=user,
        posts=posts,
        following=following,
        followers=followers,
        is_following=is_following
    )

# ---------- FOLLOW / UNFOLLOW ----------
@app.route('/follow/<int:user_id>', methods=['POST'])
@login_required
def follow(user_id):
    if user_id == session['user_id']:
        abort(400, "You cannot follow yourself")
    target = User.query.get_or_404(user_id)
    current = User.query.get(session['user_id'])
    if current.is_following(target):
        abort(400, "Already following")
    db.session.add(Follow(follower_id=current.id, followed_id=target.id))
    db.session.commit()
    return jsonify({'status': 'following'})

@app.route('/unfollow/<int:user_id>', methods=['POST'])
@login_required
def unfollow(user_id):
    if user_id == session['user_id']:
        abort(400)
    target = User.query.get_or_404(user_id)
    current = User.query.get(session['user_id'])
    rel = current.following.filter_by(followed_id=target.id).first()
    if rel:
        db.session.delete(rel)
        db.session.commit()
    return jsonify({'status': 'unfollowed'})
    # ============== MOBILE API (START) ==============

@app.route('/api/login', methods=['POST'])
def api_login():
    data = request.get_json()
    if not data:
        return jsonify({'error': 'No data'}), 400
    
    username = data.get('username')
    password = data.get('password')
    user = User.query.filter_by(username=username, password=password).first()
    
    if user:
        token = create_access_token(identity=str(user.id))
        return jsonify({
            'success': True,
            'token': token,
            'user': {
                'id': user.id,
                'username': user.username
            }
        })
    else:
        return jsonify({'error': 'Invalid username or password'}), 401


@app.route('/api/feed', methods=['GET'])
@jwt_required()
def api_feed():
    current_user_id = get_jwt_identity()
    
    posts = Post.query.order_by(Post.timestamp.desc()).limit(50).all()
    feed = []
    
    for p in posts:
        feed.append({
            'id': p.id,
            'username': p.author.username if p.author else '[deleted]',
            'title': p.title,
            'artist': p.artist,
            'platform': p.platform,
            'url': p.url,
            'thumbnail': p.thumbnail,
            'embed_url': p.embed_url,
            'timestamp': p.timestamp.isoformat(),
            'is_mine': p.user_id == current_user_id
        })
    
    return jsonify(feed)


@app.route('/api/post', methods=['POST'])
@jwt_required()
def api_post():
    current_user_id = get_jwt_identity()
    data = request.get_json()
    url = data.get('url')
    
    if not url:
        return jsonify({'error': 'URL required'}), 400
    
    platform, info = parse_track_url(url)
    if not info:
        return jsonify({'error': 'Invalid or unsupported URL'}), 400
    
    new_post = Post(
        user_id=current_user_id,
        url=url,
        title=info['title'],
        artist=info.get('artist'),
        thumbnail=info['thumbnail'],
        embed_url=info['embed_url'],
        platform=platform
    )
    db.session.add(new_post)
    db.session.commit()
    
    return jsonify({
        'success': True,
        'post': {
            'id': new_post.id,
            'username': User.query.get(current_user_id).username,
            'title': new_post.title,
            'artist': new_post.artist,
            'platform': new_post.platform
        }
    })

# ============== MOBILE API (END) ==============

# -------------- DELETE --------------
@app.route('/delete/<int:post_id>', methods=['POST'])
@login_required
def delete_post(post_id):
    post = Post.query.get_or_404(post_id)
    if post.user_id != session['user_id']:
        abort(403)
    db.session.delete(post)
    db.session.commit()
    return jsonify(success=True)

# ---------- RUN ----------
if __name__ == '__main__':
    with app.app_context():
        db.create_all()
        print("Tables ensured")
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)

import yt_dlp
from flask import jsonify, request

@app.route('/api/ytdl')
def ytdl():
    url = request.args.get('url')
    if not url:
        return jsonify({'error': 'No URL'}), 400

    try:
        # Full Chrome headers
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-us,en;q=0.5',
            'Accept-Encoding': 'gzip,deflate',
            'Accept-Charset': 'ISO-8859-1,utf-8;q=0.7,*;q=0.7',
            'Referer': 'https://www.youtube.com/',
            'Origin': 'https://www.youtube.com',
        }

        ydl_opts = {
            'format': 'bestaudio/best',
            'quiet': True,
            'no_warnings': True,
            'noplaylist': True,
            'http_headers': headers,
            'cookiefile': 'cookies.txt',  # Optional: if you have real cookies
            'extractor_args': {
                'youtube': {
                    'skip': ['hls', 'dash'],
                }
            }
        }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if not info or 'url' not in info:
                return jsonify({'error': 'No audio stream found'}), 404
            return jsonify({'audioUrl': info['url']})

    except Exception as e:
        error_msg = str(e)
        if 'Sign in to confirm' in error_msg:
            return jsonify({'error': 'YouTube blocked this video. Try a different one.'}), 403
        return jsonify({'error': error_msg}), 500
import requests
from flask import Response, stream_with_context

import requests
from flask import Response

@app.route('/api/audio')
def audio_proxy():
    url = request.args.get('url')
    if not url:
        return "No URL", 400

    try:
        # Stream with minimal headers
        response = requests.get(
            url,
            stream=True,
            timeout=15,
            headers={'User-Agent': 'Mozilla/5.0'}
        )
        response.raise_for_status()

        def generate():
            for chunk in response.iter_content(chunk_size=32768):
                if chunk:
                    yield chunk

        return Response(
            generate(),
            content_type=response.headers.get('Content-Type', 'audio/webm'),
            direct_passthrough=True
        )
    except Exception as e:
        print("AUDIO PROXY ERROR:", str(e))
        return f"Proxy failed: {str(e)}", 500











