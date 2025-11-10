from flask import Flask, render_template, request, redirect, url_for, session
from flask_sqlalchemy import SQLAlchemy
import requests, re, os
from datetime import datetime

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'earshot-secret-2025')
app.config['SQLALCHEMY_DATABASE_URI'] = os.environ.get('DATABASE_URL', 'sqlite:///earshot.db').replace('postgres://', 'postgresql://')
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# MODELS
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
    thumbnail = db.Column(db.String258)
    embed_url = db.Column(db.String(300))
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    user = db.relationship('User', backref='posts')

# LAZY DB INIT — ONLY ON FIRST REQUEST
def create_db():
    try:
        with app.app_context():
            db.create_all()
            print("DB tables created.")
    except Exception as e:
        print(f"DB create error: {e}")

@app.before_first_request
def before_first_request():
    create_db()

# ROUTES
@app.route('/')
def index():
    if 'user_id' not in session:
        return redirect('/login')
    try:
        followed = Follow.query.filter_by(follower_id=session['user_id']).all()
        followed_ids = [f.followed_id for f in followed] + [session['user_id']]
        posts = Post.query.filter(Post.user_id.in_(followed_ids)).order_by(Post.timestamp.desc()).all()
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
        if User.query.filter_by(username=request.form['username']).first():
            return "Username taken"
        user = User(username=request.form['username'], password=request.form['password'])
        db.session.add(user)
        db.session.commit()
        session['user_id'] = user.id
        return redirect('/')
    return render_template('login.html', register=True)

@app.route('/post', methods=['GET', 'POST'])
def post():
    if 'user_id' not in session:
        return redirect('/login')
    if request.method == 'POST':
        url = request.form['url']
        # Skip API for now — just post title
        p = Post(
            user_id=session['user_id'],
            title="Test Song",
            artist="Test Artist",
            thumbnail="https://via.placeholder.com/300",
            embed_url="https://www.youtube.com/embed/dQw4w9WgXcQ",
            url=url
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
