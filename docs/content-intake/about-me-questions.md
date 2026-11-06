> **Public repo warning.** This repo is public until the Vercel cutover (P6). Anything you write in this file is visible on GitHub as soon as it's pushed. Only answer here what you'd be happy to publish. For anything marked `(private)`, or answers you'd rather draft first, use `docs/content-intake/private/` instead; that folder is gitignored and never committed.
>
> Write answers in your own words, as you'd say them. Nobody rewrites your prose: answers are only sorted into the knowledge base and checked for facts and consistency, and you approve every diff.
>
> Moved from `portfolio-v3` on 2026-10-23. Q51 (D-13) has a partial answer already: the v1 site has a working Formspree contact form.

# Blob "about Anderson" questionnaire

Answer whatever you like, right under each question. Skip anything with `skip`. Short answers are fine; Blob keeps replies to about 120 words anyway.

How this is used:
- Answers go into the knowledge base (mostly `src/content/knowledge/interests.md`, plus `faq.md` and `bio.md`). That is Blob's **only** source of facts, so if a topic isn't answered here, Blob says it doesn't know.
- Nothing goes live until you approve the KB diff.
- **Privacy rule:** the site never publishes a phone number, street address, exact birthday, or family members' names. Please don't put those here. City or region level is fine if you want it.
- Mark anything you're happy to have here but **don't** want Blob to volunteer with `(private)`.

## 1. Favorites
1. Favorite color?
Blue
3. Favorite food or cuisine? Any dish you're known for making?
My mom's homecooking, chicken parmesean, Indian food specifically butter chicken and palak paneer, Mexican, Italian cuisine. Organge Chicken. In terms of what I can make well usually any food that involves grilling
4. Favorite snack or guilty-pleasure food?
Potato chips
5. Coffee, tea, or neither? How do you take it?
Coffee, always black. Or chamomile tea.
6. Favorite movie(s)?
Interstellar, Inception
7. Favorite TV show(s) or anime?
Paradise, Attack on Titan
8. Favorite book(s), or what you're reading now?
skip
9. Favorite music: genres, artists, or a go-to coding playlist?
10. Favorite video game(s) or console?
Monster Hunter, Destiny 2, Fortnite, Pokemon. I'll usually play on my Nintendo Switch 2 or PS5.
11. Favorite sport or team?
I don't really watch sports, but always jump on the wagon for Boston sports teams.
12. Favorite place you've traveled, or a dream destination?
Loved Italy, the food was so good. Also loved going to Brazil with my wife to see her family. The food was also really good and super cheap. Drinks were amazing. 
13. Favorite season or kind of weather?
Love the fall. Winter is too cold. Summer is too hot. Spring gives me too many allergies
14. Favorite animal? Any pets you're happy for Blob to mention (name optional)?
My pet betta fish, No Name. 
15. Favorite emoji? (Blob may use it.)
🥺
## 2. Hobbies and life outside work
15. What do you do on a free weekend?
First take care of any priorities; yard work, shopping, household chores. Then spend time with family, hanging out, catching up. Spend time on side projects or working on thigns I want to build out, or work my wife has assigned to me. Also going out or seeing friends. Finally just gaming with any free time.
16. Any sports, fitness, or outdoor activities?
I'm not a very outdoorsy person but I do love ping-pong. I also enjoy tossing a frisbee or kicking around a soccer ball with my wife. 
17. Any creative hobbies (drawing, music, photography, cooking, building things)?
Love videography and photography, I own several cameras like the Sony ZV-E10 with a few different lenses, DJI Pocket 3, Insta 360 X4. I also ocasionally play the piano an attempt to learn new songs.
18. Side projects you tinker with that aren't on the site?
Stock market trading bot, Raspberry Pi projects like a word of the day in English, Spanish and Portuguese on an E-Ink display, a home server we have, messing with local LLM models that run and serve at home. Aside from that learning more how to incorporate AI in workflows that make sense. 
19. Something you're learning right now, tech or not?
20. A skill you'd like to learn someday?
Perhaps welding or woodworking. Something to do with my hands. I'm fairly handy around the house, but I'd love to be able to visualize something and construct it from start to finish. Or drawing, being able to visualize something in your mind and making that shareable with others is really cool.


## 3. Fun facts and personality
21. Three words friends or coworkers would use to describe you?
Hardworking, authentic or genuine, silly
22. A fun fact most people don't know about you?
I've never broken a bone
23. Your hidden talent?
More when being silly I do a bunch of bunch voices or accents. Makes the kids laigh
24. Morning person or night owl?
Morning person. After I turned 30. In my teenage and college years I used to be a night owl. 
25. Cats or dogs? Beach or mountains? Tabs or spaces? Light or dark mode?
Dogs. Mountains. Tabs. Dark mode.
26. Your go-to karaoke song, or a song you can't stop humming?
Don't Matter by Akon for karaoke.
Oribter by Noah Kahan for humming and sometimes singing.
Violet by Connor Price for rapping.
Capaz by Alleh for singing and vibing in the car with my wife
27. Something that always makes you laugh?
Without a doubt my wife, everything she does is funny, cute, and adorable. I love her mannerisms and how silly and open with it she is even when she doesn't realize it. 
28. Any languages you speak?
English. Spanish. Learning portuguese to speak with my wife's family. 

## 4. Career story
29. How did you get into QA and testing?
I started off in SharkNinja as a Product Development Intern and worked very closely with the SQA team there. After continuously getting my contract extended a few times, I asked to join the SQA team as they had an open role. Since they knew my work ethic, I had a quick informal interview and joined shortly after! 
30. What was your first tech job or first program you wrote?
First tech job was there at SharkNinja in my SQA Engineer role. I did a lot of work in terms of running, executing scripts, working with devs to make test methods with all the different sensors. 
At Boston Dynamics is where I wrote my first script from scratch to be used in work and testing: Monitor the robots memory while running. It was so cool to see it evolve over time: grab the info and show it to the user, now save it all to CSV, now add more processes. And then being able to share it with the team to help debug issues.
31. What do you love most about QA? What's the most underrated part of it?
What I love most is improving the end product. You know that you helped build and have input that helped push the product in a way that helps the customer and is easier and more intuitive to use. You help make sure it isn't annyoing to use, it doesn't cause friction. It all just works and makes lives easier. You're their voice and you advocate for them.
32. A bug you're proud of finding (keep it non-confidential)?
There's two. One was a behvior on a Shark robot vacuum. It had a sensor that when it reached an 80% threshold of particulates picked up, would initiate a spot clean and go over that area, in a corn-row pattern a few times. However it only did it once per room, but the code and devs kept saying it should do it multiple times per room.. It was tough to test as it took a lot of setup, time, and hope. Through a lot of persistance, videos, and having a dev run through it with me, they caught the issue and were able to fix the logic.
Another one would be an issue people were seeing internally which was a connection issue, but no one reported it. So I went ahead and made a high priorty ticket, with details, videos, logs and sparked discussions investigations. As a tester I felt frustrated that it took so much effort to connect. That is not the feeling I want a consumer to feel so I will gladly bang my head against a wall figuring it out so they don't have to. 
33. Your favorite tool or framework, and why?
skip
34. A testing hot take or opinion you'll defend?
Take the time upfront to be as explicit as possible to remove all ambiguity. This avoids confusion and variables from your testers or testers who excute your work. It helps reproducability which helps save time in the long run.
35. What does a great day at work look like for you?
skip
36. Who or what inspired you professionally (people, books, talks)?
At SharkNinja I met a really great coworker. He was one of the hardest working people I ever met. He was always quick to help, super intelligent, and always pushed me to become a better version of myself both inside and outside of work. He knew when to be serious and work, but also when to be silly and gunuiely wanted to see you improve. He's someone I try and emulate and I aim to be that for others. 
37. Career moment you're proudest of?
skip
38. What's next for you? Skills or areas you're growing into?
skip

## 5. Working with you (recruiter-friendly)
39. What kinds of roles or problems are you most excited about?
I'm excited about all of the problems. I don't shy away from anything new. In all of my roles, I've had to learn new software for testing, new frameworks for automated testing, or new methods for test excution. I've had to works with developers to create methods for testing or automation testing, and hardware and electrical engineers for physical rigs and harnesses for testing. Sometimes I even have to do some of the work myself. 
40. Remote, hybrid, or onsite preference? (Region-level only.)
skip
41. Open to new opportunities right now? How should Blob phrase that?
I'm always interested in learning or hearing about new opportunities.
42. How would you describe your leadership or mentoring style?
Patient and understanding. There's a human aspect to it. We are all people and everyone learns different whether a different pace or style and you have to adapt that in order to be able to mentor well. 
43. How do you like to collaborate with developers and product folks?
I love to learn a little bit about them and guinuienly get interested in their interests and chat with them about that when I see them. However when it comes to work I directly reach out to them, with the question in the same "Hey! I had a question about..." so as to not beat around the bush and eat up their time. I have a problem, they have a solution but sometimes not a bunch of time. 
44. What should a recruiter know about you that a resume doesn't say?
skip

## 6. About this site and Blob
45. Why did you build Blob? Anything you want visitors to take away?
I wanted people who visit to see another form of delivering my content. Instead of sifting through a bunch of text or using "CTRL + F" to find keywords, they can just ask about something specific. I want people to see what is possible to make and do and you can have fun with it and still have a human touch. 
46. What should Blob say if someone asks "what's Anderson like?"
47. Is there a question you'd love Blob to be asked? What's the ideal answer?
Another questions I think would be cute is someone asking blob about blob. He's my little assistant with a personality. A partner. Maybe he has his own likes and dislikes too and he can talk about how he was made, his tooling, the process etc, especially for people who are curious but might be intimidated by doing something similar they can be encouraged and have a starting point. 
48. Any topics Blob should always decline, even if they seem harmless?
Politics, world views, anything controversial, or innapropriate. Basically I believe the rule is anything you wouldn't bring up at work. I want to be professional, and I am.
49. Should Blob tell jokes about you? Anything off-limits?
Yes blob can make little jokes and quips about me. I love to laugh at myself, I don't mind being the butt of jokes and having people laugh with me

## 7. Open decisions Blob is waiting on
50. **D-12:** What was your role in Orbit Hop (built it solo, co-built it, published it, something else)?
I built it solo, with the assistance of AI. Together we designed, coded, implemented, tested, and published.
51. **D-13:** Is there, or will there be, a contact form on the site? If not, Blob points only to email, LinkedIn, GitHub and the #contact section.
Yes there is a contact form and I beleive what I used was something like formspree and I would get emails from there.