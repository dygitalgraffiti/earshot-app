from flask import Flask, render_template, request, redirect, url_for, session, flash
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
    init_db()  # REQUIRED
    if 'user_id' not in session:
        return render_template('index.html', posts=[], current_user=None)
    
    current_user = app.User.query.get(session['user_id'])
    posts = app.Post.query.order_by(app.Post.timestamp.desc()).all()
    
    # Populate user for each post
    for post in posts:
        post.username = app.User.query.get(post.user_id).username
    
    return render_template('index.html', posts=posts, current_user=current_user)

@app.route('/login', methods=['GET', 'POST'])
def login():
    init_db()  # REQUIRED
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if not username or not password:
            flash('Both fields required.')
            return redirect(url_for('login'))
        user = app.User.query.filter_by(username=username, password=password).first()
        if user:
            session['user_id'] = user.id
            flash('Logged in!')
            return redirect(url_for('index'))
        flash('Invalid credentials.')
        return redirect(url_for('login'))
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    init_db()  # REQUIRED
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        if not username or not password:
            flash('Both fields required.')
            return redirect(url_for('register'))
        if app.User.query.filter_by(username=username).first():
            flash('Username already taken.')
            return redirect(url_for('register'))
        user = app.User(username=username, password=password)
        db.session.add(user)
        db.session.commit()
        session['user_id'] = user.id
        flash('Account created! Welcome to Earshot.')
        return redirect(url_for('index'))
    return render_template('register.html')

@app.route('/post', methods=['GET', 'POST'])
def post():
    init_db()  # REQUIRED
    if 'user_id' not in session:
        return redirect(url_for('login'))
    
    if request.method == 'POST':
        url = request.form.get('url')
        if not url:
            flash('URL required.')
            return redirect(url_for('post'))
        
        # Parse platform and data
        platform = None
        data = None
        if 'spotify.com' in url:
            platform = 'spotify'
            data = get_spotify_data(url)
        elif 'youtube.com' in url or 'youtu.be' in url:
            platform = 'youtube'
            data = get_youtube_data(url)
        elif 'music.apple.com' in url:
            platform = 'apple'
            data = get_apple_data(url)
        
        if not data:
            flash('Unsupported or invalid URL.')
            return redirect(url_for('post'))
        
        p = app.Post(
            user_id=session['user_id'],
            platform=platform,
            url=url,
            title=data['title'],
            artist=data['artist'],
            thumbnail=data['thumbnail'],
            embed_url=data['embed_url']
        )
        db.session.add(p)
        db.session.commit()
        flash('Track shared!')
        return redirect(url_for('index'))
    
    return render_template('post.html')

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
            + '?client_encoding=utf8'
        )
        app.config['SQLALCHEMY_DATABASE_URI'] = db_uri

        # === BLOCK psycopg2 BEFORE SQLAlchemy ===
        import sqlalchemy.dialects.postgresql as pg
        pg.psycopg2 = None
        # ========================================

        db = SQLAlchemy(app)  # Now safe

        # === MODELS ===
        class User(db.Model):
            ...
        class Follow(db.Model):
            ...
        class Post(db.Model):
            ...

        app.User = User
        app.Follow = Follow
        app.Post = Post

    return db

# Initialize DB on every request
@app.before_request
def before_request():
    init_db()

# Create tables at startup (safe)
with app.app_context():
    db_instance = init_db()
    db_instance.create_all()













