from flask import Flask, render_template, request, session, redirect, url_for, flash, jsonify
from flask_sqlalchemy import SQLAlchemy
import requests, re
from datetime import datetime
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'earshot-secret-key-2025')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
# === LAZY DB INIT ===
db = None  # We'll init this later
# =======================================================
# ========================= MEDIA PARSERS =========================
def get_spotify_data(url):
    match = re.search(r'spotify\.com/track/([a-zA-Z0-9]+)', url)
    if not match: return None
    track_id = match.group(1)
    try:
        oembed = requests.get(f"https://open.spotify.com/oembed?url={url}").json()
        full = oembed['title']
        parts = full.split(' · ')
        song = parts[0]
        artist = parts[1] if len(parts) > 1 else ''
        return {
            'title': song,
            'artist': artist,
            'thumbnail': oembed['thumbnail_url'],
            'embed_url': f"https://open.spotify.com/embed/track/{track_id}"
        }
    except:
        return None

def get_youtube_data(url):
    url = re.sub(r'music\.youtube\.com', 'youtube.com', url)
    match = re.search(r'youtube\.com/watch\?v=([a-zA-Z0-9_-]+)', url)
    if not match: return None
    video_id = match.group(1)
    try:
        oembed = requests.get(f"https://www.youtube.com/oembed?url={url}&format=json").json()
        title = oembed['title']
        artist = title.split(' - ')[0] if ' - ' in title else 'Artist'
        song = title.split(' - ')[1] if ' - ' in title else title
        return {
            'title': song,
            'artist': artist,
            'thumbnail': oembed['thumbnail_url'],
            'embed_url': f"https://www.youtube.com/embed/{video_id}"
        }
    except:
        return None

def get_apple_data(url):
    match = re.search(r'music\.apple\.com/[^/]+/song/(\d+)', url)
    if not match: return None
    song_id = match.group(1)
    embed_base = url.replace('/song/', '/embed/song/')
    try:
        api_url = f"https://itunes.apple.com/lookup?id={song_id}&entity=song"
        data = requests.get(api_url).json()
        if data['resultCount'] > 0:
            track = data['results'][0]
            return {
                'title': track['trackName'],
                'artist': track['artistName'],
                'thumbnail': track['artworkUrl100'].replace('100x100', '300x300'),
                'embed_url': embed_base
            }
    except:
        pass
    return None

def get_media_data(url):
    if 'spotify.com' in url:
        return get_spotify_data(url), 'spotify'
    elif 'youtube.com' in url or 'music.youtube.com' in url:
        return get_youtube_data(url), 'youtube'
    elif 'music.apple.com' in url:
        return get_apple_data(url), 'apple'
    return None, None

# ========================= ROUTES =========================
@app.route('/')
def index():
    init_db()
    posts = app.Post.query.order_by(app.Post.timestamp.desc()).all()
    
    # Attach username to each post
    for post in posts:
        poster = app.User.query.get(post.user_id)
        post.username = poster.username if poster else "[deleted]"

    return render_template('index.html', posts=posts)
@app.route('/login', methods=['GET', 'POST'])
def login():
    init_db()
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        user = app.User.query.filter_by(username=username, password=password).first()
        if user:
            return jsonify({
                'success': True,
                'user_id': user.id,
                'username': user.username
            })
        else:
            return jsonify({'success': False, 'error': 'Invalid credentials'}), 401
    
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    init_db()
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if not username or not password:
            return jsonify({'success': False, 'error': 'Both fields required'}), 400
        if app.User.query.filter_by(username=username).first():
            return jsonify({'success': False, 'error': 'Username taken'}), 400
        
        user = app.User(username=username, password=password)
        db.session.add(user)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'user_id': user.id,
            'username': user.username
        })
    
    return render_template('register.html')

@app.route('/post', methods=['GET', 'POST'])
def post():
    if request.method == 'GET':
        return render_template('post.html')

    # Accept both JSON (from JS) and form data (fallback)
    if request.is_json:
        data = request.get_json()
        user_id = data.get('user_id')
        url = data.get('url')
    else:
        user_id = request.form.get('user_id')
        url = request.form.get('url')

    if not user_id or not url:
        return jsonify({'error': 'Missing user or URL'}), 400

    user = app.User.query.get(int(user_id))
    if not user:
        return jsonify({'error': 'Invalid user'}), 401

    # Parse URL
    platform, track_data = parse_track_url(url)
    if not track_data:
        return jsonify({'error': 'Unsupported URL'}), 400

    post = app.Post(
        user_id=user.id,
        url=url,
        platform=platform,
        title=track_data['title'],
        artist=track_data['artist'],
        thumbnail=track_data['thumbnail'],
        embed_url=track_data['embed_url']
    )
    db.session.add(post)
    db.session.commit()

    return jsonify({'success': True, 'redirect': '/'})
@app.route('/follow/<int:user_id>')
def follow(user_id):
    init_db()  # REQUIRED
    if 'user_id' not in session or session['user_id'] == user_id:
        return redirect(url_for('index'))
    f = app.Follow(follower_id=session['user_id'], followed_id=user_id)
    db.session.add(f)
    db.session.commit()
    return redirect(url_for('index'))

@app.route('/logout')
def logout():
    session.pop('user_id', None)
    flash('Logged out.')
    return redirect(url_for('login'))

# ========================= RUN APP =========================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
# === LAZY DB INITIALIZATION ===
def init_db():
    global db
    if db is None:
        # === SET DATABASE URI ===
        db_uri = (
            os.environ.get('DATABASE_URL', 'sqlite:///earshot.db')
            .replace('postgres://', 'postgresql+psycopg://', 1)
            .replace('postgresql://', 'postgresql+psycopg://', 1)  # FORCE psycopg
            + '?client_encoding=utf8'
        )
        app.config['SQLALCHEMY_DATABASE_URI'] = db_uri

        # === BLOCK psycopg2 BEFORE SQLAlchemy ===
        import sqlalchemy.dialects.postgresql as pg
        pg.psycopg2 = None
        # ========================================

        db = SQLAlchemy(app)

        # === MODELS ===
        class User(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            username = db.Column(db.String(80), unique=True, nullable=False)
            password = db.Column(db.String(120), nullable=False)

        class Follow(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            follower_id = db.Column(db.Integer, db.ForeignKey('user.id'))
            followed_id = db.Column(db.Integer, db.ForeignKey('user.id'))

        class Post(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            user_id = db.Column(db.Integer, db.ForeignKey('user.id'))
            platform = db.Column(db.String(20))
            url = db.Column(db.String(300))
            title = db.Column(db.String(200))
            artist = db.Column(db.String(200))
            thumbnail = db.Column(db.String(300))
            embed_url = db.Column(db.String(300))
            timestamp = db.Column(db.DateTime, default=datetime.utcnow)
            user = db.relationship('User', backref='posts')

        app.User = User
        app.Follow = Follow
        app.Post = Post

    return db

# Initialize DB on every request
@app.before_request
def before_request():
    init_db()

# === CREATE TABLES AT STARTUP (SAFE) ===
with app.app_context():
    db_instance = init_db()
    db_instance.create_all()
    print("Database initialized and tables created.")
def parse_track_url(url):
    if 'spotify.com' in url:
        return 'spotify', {
            'title': 'Spotify Track',
            'artist': 'Artist',
            'thumbnail': '',
            'embed_url': url.replace('open.spotify.com', 'open.spotify.com/embed')
        }
    elif 'youtube.com' in url or 'youtu.be' in url:
        return 'youtube', {
            'title': 'YouTube Video',
            'artist': 'Creator',
            'thumbnail': '',
            'embed_url': url.replace('watch?v=', 'embed/')
        }
    elif 'music.apple.com' in url:
        return 'apple', {
            'title': 'Apple Music Track',
            'artist': 'Artist',
            'thumbnail': '',
            'embed_url': url
        }
    return None, None



























