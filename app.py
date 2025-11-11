from flask import Flask, render_template, request, redirect, url_for, session, flash
from flask_sqlalchemy import SQLAlchemy
import requests, re
from datetime import datetime
import os

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'earshot-secret-key-2025')
app.config['SQLALCHEMY_DATABASE_URI'] = (
    os.environ.get('DATABASE_URL', 'sqlite:///earshot.db')
    .replace('postgres://', 'postgresql+psycopg://', 1)
    + '?client_encoding=utf8'
)
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db = SQLAlchemy(app)

# ========================= MODELS =========================
class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password = db.Column(db.String(120), nullable=False)  # TODO: hash later

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
    if 'user_id' not in session:
        return redirect('/login')
    followed = Follow.query.filter_by(follower_id=session['user_id']).all()
    followed_ids = [f.followed_id for f in followed] + [session['user_id']]
    posts = Post.query.filter(Post.user_id.in_(followed_ids))\
                      .order_by(Post.timestamp.desc()).all()
    current_user = User.query.get(session['user_id'])
    return render_template('feed.html', posts=posts, current_user=current_user)

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        user = User.query.filter_by(username=request.form['username']).first()
        if user and user.password == request.form['password']:
            session['user_id'] = user.id
            flash('Logged in successfully!')
            return redirect('/')
        flash('Invalid username or password.')
    return render_template('login.html')

@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')

        if not username or not password:
            flash('Both fields are required.')
            return redirect(url_for('register'))

        if User.query.filter_by(username=username).first():
            flash('Username already taken.')
            return redirect(url_for('register'))

        user = User(username=username, password=password)
        db.session.add(user)
        db.session.commit()
        session['user_id'] = user.id
        flash('Account created! Welcome to Earshot.')
        return redirect('/')

    return render_template('register.html')

@app.route('/post', methods=['GET', 'POST'])
def post():
    if 'user_id' not in session:
        return redirect('/login')

    if request.method == 'POST':
        url = request.form.get('url', '').strip()
        if not url:
            flash('Please enter a music URL.')
            return redirect(url_for('post'))

        data, platform = get_media_data(url)
        if not data:
            flash('Unsupported link. Try Spotify, YouTube, or Apple Music.')
            return redirect(url_for('post'))

        try:
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
            flash('Track shared!')
        except Exception as e:
            db.session.rollback()
            flash('Error saving post. Try again.')
            app.logger.error(f"Post error: {e}")

        return redirect('/')

    return render_template('post.html')

@app.route('/follow/<int:user_id>')
def follow(user_id):
    if 'user_id' not in session or session['user_id'] == user_id:
        return redirect('/')
    f = Follow(follower_id=session['user_id'], followed_id=user_id)
    db.session.add(f)
    db.session.commit()
    return redirect('/')

@app.route('/logout')
def logout():
    session.pop('user_id', None)
    flash('Logged out.')
    return redirect('/login')

# ========================= INIT DB ON FIRST REQUEST =========================
@app.before_first_request
def create_tables():
    db.create_all()

# ========================= RUN APP =========================
if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)



