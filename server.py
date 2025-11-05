from flask import Flask, send_from_directory, send_file
from flask_cors import CORS
import os

app = Flask(__name__, static_folder='.')
CORS(app)  # CORS 허용

@app.route('/')
def index():
    return send_file('index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('.', path)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print('=' * 50)
    print('  Flask 웹 서버 시작')
    print('=' * 50)
    print('')
    print(f'브라우저에서 http://localhost:{port} 을 열어주세요.')
    print('')
    print('종료하려면 Ctrl+C를 누르세요.')
    print('=' * 50)
    print('')
    
    app.run(host='0.0.0.0', port=port, debug=False)
