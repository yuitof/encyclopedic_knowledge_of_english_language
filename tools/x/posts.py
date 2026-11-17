"""Normalize post content, including long posts and embedded quoted/reposted posts."""
import html
import re
from api import walk, XError

ID = re.compile(r'[1-9][0-9]{0,24}\Z')


def post_id(value):
    value = str(value)
    if ID.fullmatch(value):
        return value
    match = re.fullmatch(r'https://(?:www\.)?(?:x|twitter)\.com/(?:[A-Za-z0-9_]+|i/web)/status/([1-9][0-9]{0,24})(?:[/?#].*)?', value)
    if not match:
        raise ValueError('Use a numeric post ID or an https://x.com/USER/status/ID URL.')
    return match[1]


def unwrap(result):
    while isinstance(result, dict) and result.get('__typename') == 'TweetWithVisibilityResults':
        result = result.get('tweet', {})
    return result if isinstance(result, dict) else {}


def normalize(result, retrieved_at):
    """Return only content fields: no request headers, cookies, or entire timeline payloads."""
    result = unwrap(result)
    identifier = result.get('rest_id', '')
    legacy = result.get('legacy', {})
    if not ID.fullmatch(identifier) or not isinstance(legacy.get('full_text'), str):
        return None
    author = result.get('core', {}).get('user_results', {}).get('result', {})
    core = author.get('core', {}) or author.get('legacy', {})
    handle = core.get('screen_name', '')
    note = result.get('note_tweet', {}).get('note_tweet_results', {}).get('result', {})
    long_text = note.get('text')
    post = {'schema_version': 1, 'id': identifier, 'source_url': f'https://x.com/{handle or "i/web"}/status/{identifier}',
            'retrieved_at': retrieved_at, 'created_at': legacy.get('created_at'),
            'author': {'id': author.get('rest_id'), 'screen_name': handle, 'name': core.get('name', '')},
            'text': html.unescape(long_text if isinstance(long_text, str) else legacy['full_text']),
            'text_source': 'note_tweet' if isinstance(long_text, str) else 'legacy.full_text',
            'language': legacy.get('lang'), 'entities': note.get('entity_set') or legacy.get('entities', {}),
            'media': legacy.get('extended_entities', {}).get('media', []),
            'reply_to_post_id': legacy.get('in_reply_to_status_id_str'),
            'quoted_post_id': legacy.get('quoted_status_id_str'),
            'reposted_post_id': None}
    repost = unwrap(legacy.get('retweeted_status_result', {}).get('result', {}))
    if repost.get('rest_id'):
        post['reposted_post_id'] = repost['rest_id']
    article = result.get('article', {}).get('article_results', {}).get('result')
    if isinstance(article, dict):
        post['article'] = {k: article[k] for k in ('rest_id', 'title', 'preview_text', 'plain_text', 'content_state', 'cover_media') if k in article}
    if isinstance(note.get('richtext'), dict):
        post['richtext'] = note['richtext']
    card = result.get('card', {}).get('legacy')
    if isinstance(card, dict):
        post['card'] = {k: card[k] for k in ('name', 'url', 'binding_values') if k in card}
    return post


FIELDS = {'schema_version', 'id', 'source_url', 'retrieved_at', 'created_at', 'author', 'text', 'text_source',
          'language', 'entities', 'media', 'reply_to_post_id', 'quoted_post_id', 'reposted_post_id', 'article', 'richtext', 'card'}


def valid_post(data, identifier):
    return (isinstance(data, dict) and set(data) <= FIELDS and data.get('schema_version') == 1
            and ID.fullmatch(identifier) is not None and data.get('id') == identifier
            and isinstance(data.get('text'), str) and isinstance(data.get('author'), dict)
            and set(data['author']) <= {'id', 'screen_name', 'name'}
            and isinstance(data.get('retrieved_at'), str) and isinstance(data.get('entities'), dict)
            and isinstance(data.get('media'), list)
            and isinstance(data.get('source_url'), str)
            and re.fullmatch(r'https://x\.com/(?:[A-Za-z0-9_]+|i/web)/status/' + identifier, data['source_url']) is not None)


def embedded_posts(result, retrieved_at):
    posts = {}
    for item in walk(result):
        if item.get('__typename') == 'Tweet':
            post = normalize(item, retrieved_at)
            if post:
                posts[post['id']] = post
    return posts


def timeline(data, retrieved_at):
    instructions = [d['instructions'] for d in walk(data) if isinstance(d.get('instructions'), list)]
    if not instructions:
        raise XError('X timeline schema missing instructions; not treated as an empty collection.')
    entries, terminated, recognized = [], False, False
    for group in instructions:
        for instruction in group:
            kind = instruction.get('type')
            if kind in ('TimelineTerminateTimeline', 'TimelineAddEntries', 'TimelineReplaceEntry', 'TimelineAddToModule'):
                recognized = True
            if kind == 'TimelineTerminateTimeline' and instruction.get('direction') == 'Bottom':
                terminated = True
            if kind == 'TimelineAddEntries':
                entries.extend(instruction.get('entries', []))
            elif kind == 'TimelineReplaceEntry':
                entries.append(instruction.get('entry', {}))
            elif kind == 'TimelineAddToModule':
                entries.extend(instruction.get('moduleItems', []))
    if not recognized:
        raise XError('X timeline has no recognized update instruction; coverage is unknown.')
    cursor_only = bool(entries) and all(e.get('content', {}).get('cursorType') in ('Top', 'Bottom') for e in entries)
    members, posts, cursor, unavailable = [], {}, None, []
    for entry in entries:
        content = entry.get('content', entry)
        if any(d.get('promotedMetadata') or d.get('promoted_metadata') for d in walk(content)):
            continue
        for item in walk(content):
            if item.get('cursorType') == 'Bottom' and isinstance(item.get('value'), str):
                cursor = item['value']
            # Only actual timeline items create collection membership; embedded quotes don't.
            result = item.get('tweet_results', {}).get('result')
            if result is None or not (item.get('itemType') == 'TimelineTweet' or item.get('__typename') == 'TimelineTweet'):
                continue
            post = normalize(result, retrieved_at)
            posts.update(embedded_posts(result, retrieved_at))
            if post:
                posts[post['id']] = post
                if post['id'] not in members:
                    members.append(post['id'])
            else:
                identifier = entry.get('entryId', '').removeprefix('tweet-')
                if ID.fullmatch(identifier):
                    unavailable.append(identifier)
    return {'members': members, 'posts': posts, 'cursor': None if terminated else cursor, 'unavailable': unavailable, 'cursor_only': cursor_only}
