"""Parse Old Reddit documents and cookie-authenticated JSON listings."""
import copy
import re
from urllib.parse import urljoin, urlsplit, parse_qs

from bs4 import BeautifulSoup

ACCOUNT = re.compile(r'[a-z0-9_-]{3,20}\Z')
ID = re.compile(r't[13]_[a-z0-9]{1,16}\Z')
COLLECTIONS = ('upvoted', 'saved', 'downvoted', 'hidden', 'submitted', 'comments')
ORIGIN = 'https://old.reddit.com'


class RedditError(ValueError):
    """A fixed, credential-free failure message safe to show to the user."""


class Unavailable(RedditError):
    """The origin explicitly returned HTTP 404 or 410 for an individual source."""


def source_url(value):
    """Accept only Reddit post/comment permalinks; never fetch arbitrary page links."""
    url = urlsplit(urljoin(ORIGIN, value))
    if (url.scheme != 'https' or url.hostname not in ('reddit.com', 'www.reddit.com', 'old.reddit.com')
            or url.username or url.password or url.port not in (None, 443)):
        raise RedditError('Use an HTTPS Reddit post/comment permalink.')
    match = re.fullmatch(r'/(?:r/[A-Za-z0-9_]+/)?comments/([a-z0-9]{1,16})(?:/[^/]+(?:/([a-z0-9]{1,16}))?)?/?', url.path)
    if not match:
        raise RedditError('Use a full Reddit comments permalink (short /s/ links are unsupported).')
    identifier = ('t1_' + match[2]) if match[2] else ('t3_' + match[1])
    return identifier, ORIGIN + url.path.rstrip('/') + '/'


def document(markup, expected=None):
    soup = BeautifulSoup(markup, 'html.parser')
    user = soup.select_one('#header-bottom-right .user a[href]')
    if user is None:
        raise RedditError('Signed-in Old Reddit header missing: session, challenge, or frontend changed.')
    match = re.fullmatch(r'/(?:user|u)/([A-Za-z0-9_-]{3,20})/?', urlsplit(urljoin(ORIGIN, user['href'])).path)
    if not match or not ACCOUNT.fullmatch(match[1].lower()):
        raise RedditError('Cannot verify the signed-in Reddit identity.')
    account = match[1].lower()
    if expected and account != expected:
        raise RedditError('Signed-in Reddit identity differs from the selected archive; refusing cache mixing.')
    return soup, account


def own(node, selector):
    # Nested comments have their own author/body/permalink. Never borrow a child's.
    return next((n for n in node.select(selector) if n.find_parent(class_='thing') is node), None)


def text(node):
    if node is None:
        return ''
    node = copy.copy(node)
    for br in node.select('br'):
        br.replace_with('\n')
    for block in node.select('p, blockquote, li, pre, h1, h2, h3, h4'):
        block.insert_before('\n')
        block.insert_after('\n')
    return re.sub(r'\n[ \t]*\n[\s\n]*', '\n\n', node.get_text()).strip()


def normalize(node, retrieved_at):
    identifier = node.get('data-fullname', '')
    if not ID.fullmatch(identifier):
        raise RedditError('Reddit content has an invalid or missing fullname.')
    link = own(node, 'a.bylink') if identifier.startswith('t1_') else own(node, 'a.comments')
    if link is None:
        raise RedditError('Reddit content permalink missing; source schema changed.')
    actual, url = source_url(link.get('href', ''))
    if identifier != actual:
        raise RedditError('Reddit content ID and permalink disagree.')
    author, title = own(node, 'a.author'), own(node, 'a.title')
    body = own(node, '.usertext-body .md')
    timestamp, subreddit = own(node, 'time[datetime]'), own(node, 'a.subreddit')
    # Some self posts hide their body until the individual source is opened.
    if identifier.startswith('t1_') and body is None:
        raise RedditError('Comment body missing; not caching an incomplete source.')
    if identifier.startswith('t3_') and title is None:
        raise RedditError('Post title missing; source schema changed.')
    return {'schema_version': 1, 'id': identifier, 'source_url': url,
            'retrieved_at': retrieved_at, 'created_at': timestamp['datetime'] if timestamp else None,
            'author': author.get_text(strip=True) if author else '[deleted]',
            'subreddit': subreddit.get_text(strip=True) if subreddit else None,
            'title': text(title), 'text': text(body),
            'outbound_url': title.get('href') if title else None,
            'text_source': 'old_reddit_html',
            'parent_id': node.get('data-parent-fullname') or None}


FIELDS = {'schema_version', 'id', 'source_url', 'retrieved_at', 'created_at', 'author',
          'subreddit', 'title', 'text', 'outbound_url', 'text_source', 'parent_id'}


def valid_post(data, identifier):
    if (not isinstance(data, dict) or not FIELDS <= set(data) or set(data) - FIELDS - {'body_status'}
            or not ID.fullmatch(identifier)):
        return False
    if 'body_status' in data and (data['body_status'] not in ('spoiler_hidden', 'not_exposed') or data.get('text') != '' or not identifier.startswith('t3_')):
        return False
    try:
        return (data['schema_version'] == 1 and data['id'] == identifier
                and source_url(data['source_url']) == (identifier, data['source_url'])
                and all(isinstance(data[k], str) for k in ('text', 'title', 'author', 'retrieved_at'))
                and all(data[k] is None or isinstance(data[k], str) for k in ('created_at', 'subreddit', 'outbound_url', 'parent_id'))
                and data['text_source'] == 'old_reddit_html')
    except (ValueError, TypeError):
        return False


def listing(markup, account, collection):
    soup, _ = document(markup, account)
    selected = soup.select_one('.tabmenu li.selected a[href]')
    if selected is None or urlsplit(urljoin(ORIGIN, selected['href'])).path.rstrip('/').lower() != f'/user/{account}/{collection}':
        raise RedditError('Reddit did not confirm the requested account collection; coverage is unknown.')
    table = soup.select_one('div.content[role=main] > #siteTable, div.content > #siteTable')
    if table is None:
        raise RedditError('Reddit listing container missing; coverage is unknown.')
    nodes = table.find_all(class_='thing', recursive=False)
    members = {}
    for node in nodes:
        if 'promoted' in node.get('class', []):
            continue
        identifier = node.get('data-fullname', '')
        link = own(node, 'a.bylink') if identifier.startswith('t1_') else own(node, 'a.comments')
        if not ID.fullmatch(identifier) or link is None:
            raise RedditError('Unrecognized Reddit listing item; coverage remains partial.')
        actual, url = source_url(link.get('href', ''))
        if actual != identifier:
            raise RedditError('Reddit listing ID and permalink disagree.')
        members[identifier] = url
    next_link = table.select_one('.next-button a[href], a[rel~=next][href]')
    cursor = None
    if next_link:
        url = urlsplit(urljoin(ORIGIN, next_link['href']))
        if (url.scheme != 'https' or url.netloc != 'old.reddit.com'
                or url.path.rstrip('/').lower() != f'/user/{account}/{collection}'):
            raise RedditError('Unexpected pagination destination; refusing to follow it.')
        values = parse_qs(url.query).get('after', [])
        if len(values) != 1 or not ID.fullmatch(values[0]):
            raise RedditError('Reddit next-page cursor missing or changed.')
        cursor = values[0]
    if not members and (not table.select_one('#noresults, .noresults') or cursor):
        raise RedditError('Unrecognized empty Reddit listing; not assuming an empty collection.')
    return {'members': members, 'cursor': cursor}


def json_account(payload):
    data = payload.get('data') if isinstance(payload, dict) else None
    name = data.get('name') if isinstance(data, dict) else None
    if not isinstance(name, str) or not ACCOUNT.fullmatch(name.lower()):
        raise RedditError('Signed-in Reddit identity missing from the JSON response.')
    return name.lower()


def json_listing(payload):
    data = payload.get('data') if isinstance(payload, dict) and payload.get('kind') == 'Listing' else None
    if not isinstance(data, dict) or not isinstance(data.get('children'), list) or 'after' not in data:
        raise RedditError('Unrecognized Reddit JSON listing. Coverage remains partial.')
    # The listing's CSRF token is distinct from the one in /api/me.json.
    # Its presence is a signed-in response signal, not an account identifier.
    if not isinstance(data.get('modhash'), str) or not data['modhash'].strip():
        raise RedditError('Reddit JSON listing is missing its signed-in session marker. Coverage remains partial.')
    members = {}
    for child in data['children']:
        entry = child.get('data') if isinstance(child, dict) else None
        if not isinstance(entry, dict):
            raise RedditError('Unrecognized Reddit JSON listing item. Coverage remains partial.')
        identifier, permalink = entry.get('name'), entry.get('permalink')
        if (not isinstance(identifier, str) or not ID.fullmatch(identifier)
                or child.get('kind') != identifier[:2] or not isinstance(permalink, str)):
            raise RedditError('Reddit JSON listing item is missing a valid ID or permalink.')
        actual, url = source_url(permalink)
        if actual != identifier:
            raise RedditError('Reddit listing ID and permalink disagree.')
        members[identifier] = url
    cursor = data['after']
    if cursor is not None and (not isinstance(cursor, str) or not ID.fullmatch(cursor) or not members):
        raise RedditError('Reddit JSON listing has an unexpected continuation cursor.')
    return {'members': members, 'cursor': cursor}


def source(markup, identifier, retrieved_at, account):
    soup, _ = document(markup, account)
    node = soup.select_one(f'.thing[data-fullname="{identifier}"]')
    if node is None:
        raise RedditError('Requested Reddit source absent: access restriction, removal, or schema change.')
    # A hidden/expandable selftext is not a verified full source.
    if identifier.startswith('t3_') and 'self' in node.get('class', []) and own(node, '.usertext-body .md') is None:
        if own(node, '.expando-gate--spoiler') is not None:
            post = normalize(node, retrieved_at)
            post['body_status'] = 'spoiler_hidden'
            return post
        if (own(node, '.md') is None and own(node, '.expando') is None
                and own(node, '.expando-button, form.usertext') is None):
            # Some historical self-posts expose their title and no body markup
            # or expansion control. Archive only what was actually exposed.
            post = normalize(node, retrieved_at)
            post['body_status'] = 'not_exposed'
            return post
        raise RedditError('Self-post body missing; not caching an incomplete source.')
    return normalize(node, retrieved_at)
