# Release Checklist

Use this checklist before pushing a release.

## Static Checks

- Run `node --check app.js`.
- Run `git diff --check`.
- Confirm `index.html` references all CSS files and `app.js`.
- Confirm no Supabase URL or publishable key was unintentionally changed.

## Front Page

- Data station title and version are visible.
- Notice text is visible: all data is for reference and includes the group code.
- Main navigation works:
  - 数据总览
  - 集资排名
  - 奖励查询
  - 公告通知
  - 抽奖结果
  - 匿名提问

## Data Overview

- Total amount loads.
- General election amount loads.
- Birthday fund amount loads.
- Participant count loads.
- Total TOP3, general election TOP3, and birthday TOP3 display correctly.

## Rankings

- 总数据排名 displays rank, name, and total amount.
- 总选排名 displays amount and converted votes.
- 总选单场 can switch events.
- 生公排名 displays birthday fund ranking.
- 33.5 conversion note is visible where needed.

## Reward Lookup

- Name search works with aliases.
- General election rewards display correctly.
- Birthday rewards display correctly.
- Birthday message book only shows the highest reached tier.
- Special rank rewards display correctly.
- Reward production progress displays correctly.

## Announcements

- Announcement red dot appears when there are unseen announcements.
- Opening announcements clears the red dot.
- Announcement list displays pinned and normal announcements.
- Announcement detail expands.
- Announcement image displays when configured.

## Lottery

- Lottery result list displays type, name, winners, prizes, and draw time.
- Pool details can be expanded.
- Public text labels do not show raw values like `monthly`.

## Anonymous Questions

- User can submit an anonymous question.
- A query code is generated.
- User can query by code.
- Admin can view and answer questions.
- Answered questions show the answer on the front page.

## Admin

- Admin login works.
- PK event creation works.
- PK Excel import preview works.
- Birthday fund Excel import preview works.
- Name alias save works.
- Reward rule editing works.
- Reward fulfillment toggle works.
- Reward progress save works.
- Announcement save/edit/delete works.
- Lottery pool generation and draw works.
- Operation logs load.

## Mobile

- Navigation stays two columns.
- Overview is not duplicated at the top.
- Rankings are card-like and do not overlap.
- Reward lookup fits the screen.
- Announcements are readable.
- Lottery results are compact.
- Anonymous question form does not overflow.
