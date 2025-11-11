from flask import Flask, render_template, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
import requests, re, os
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'earshot-secret-2025')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///earshot.db').replace('postgres://', 'postgresql://')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELS (SIMPLIFIED — NO Follow, no relationship)
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)
    posts = db.relationship('Post', backref='user', lazy=True, cascade='all, delete-orphan')

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

# DB INIT
@app.before_request
def init_db():
    if not hasattr(app, 'db_initialized'):
        try:
            with app.app_context():
                db.create_all()
                print("DB tables created.")
            app.db_initialized = True
        except Exception as e:
            print(f"DB create error: {e}")

# HELPERS (SAME)
def get_spotify_data(url):
    match = re.search(r'spotify\.com/track/([a-zA-Z0-9]+)', url)
    if not match: return None
    track_id = match.group(1)
    try:
        oembed = requests.get(f"https://open.spotify.com/oembed?url={url}", timeout=5).json()
        full = oembed['title']
        parts = full.split(' · ')
        song = parts[0]
        artist = parts[1] if len(parts) > 1 else 'Unknown'
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
        oembed = requests.get(f"https://www.youtube.com/oembed?url={url}&format=json", timeout=5).json()
        title = oembed['title']
        parts = title.split(' - ')
        song = parts[1] if len(parts) > 1 else title
        artist = parts[0] if len(parts) > 1 else 'Unknown'
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
    try:
        api_url = f"https://itunes.apple.com/lookup?id={song_id}&entity=song"
        data = requests.get(api_url, timeout=5).json()
        if data['resultCount'] > 0:
            track = data['results'][0]
            return {
                'title': track['trackName'],
                'artist': track['artistName'],
                'thumbnail': track['artworkUrl100'].replace('100x100', '300x300'),
                'embed_url': f"https://embed.music.apple.com/us/album/.{song_id}"
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

# ROUTES
@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect('/login')
    try:
        # SIMPLIFIED QUERY — NO Follow
        posts = Post.query.filter_by(user_id=session['user_id']).order_by(Post.timestamp.desc()).all()
        current_user = User.query.get(session['user_id'])
        return render_template('feed.html', posts=posts, current_user=current_user)
    except Exception as e:
        return f"<h1>DB Error</h1><p>{e}</p><a href='/logout'>Logout</a>"

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form['username']).first()
        if user and user.password == request.form['password']:
            session['user_id'] = user.id
            return redirect('/')
        return "Wrong password"
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')

        if not username or not password:
            flash("Both username and password are required.")
            return redirect(url_for('register'))

        if User.query.filter_by(username=username).first():
            flash("Username already taken.")
            return redirect(url_for('register'))

        user = User(username=username, password=password)  # TODO: hash password later
        db.session.add(user)
        db.session.commit()
        session['user_id'] = user.id
        flash("Account created! Welcome to Earshot.")
        return redirect(url_for('index'))

    return render_template('register.html')

@app.route('/post', methods=['GET', 'POST'])
def post():
    if 'user_id' not in session:
        return redirect('/login')
    if request.method == 'POST':
        url = request.form['url'].strip()
        data, platform = get_media_data(url)
        if not data:
            return "Invalid song link", 400
        p = Post(
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
        return redirect('/')
    return render_template('post.html')

@app.route('/logout')
def logout():
    session.pop('user_id', None)
    return redirect('/login')

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)

