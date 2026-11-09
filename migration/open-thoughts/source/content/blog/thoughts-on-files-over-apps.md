---
title: Thoughts on Files over Apps
date: 2023-07-09
---

There's lots of nuance around files vs apps. There has been [an article](https://stephanango.com/file-over-app) that has gotten some people choosing sides between whether apps or files are better. I don't have a definitive answer, but here are some things to think about in this area.

Part of the argument is that proprietary files lead to data loss because apps don't last forever. In theory, this is true, but MS Word files are proprietary and have been around for a very long time and can be read by other apps such as Libre Office.

JSON is a file standard, but the data in the file can take unlimited shapes. There is no guarantee (or really, likelihood) that one app can understand JSON from another app without a lot of intervention. ([Cambria](https://www.inkandswitch.com/cambria/) is one solution for this.)

Even plain text faces this interoperability problem. We have syntaxes, such as Markdown, that we use in our text, but there are many different flavors of Markdown that all do not necessarily work together. The more complex you get with adding special meaning to plain text with syntax, the harder it is to read.

Complex things are also hard to write in text. A nicely formatted table is easy to read in Markdown (technically [MultiMarkdown,](https://fletcherpenney.net/multimarkdown/) since default Markdown doesn't have table support), but it is so difficult to write and edit and keep everything lined up. It is also easy to leave off a character needed for the syntax and have everything break when you run it through an interpreter.

Also, when we use syntax like Markdown, we break the semantics of special characters. A `*` symbol is originally used for defining footnotes (true its original meaning was arbitrary, as technically every symbol is), but in Markdown it can mean a bullet point or that text should be italicized. The original meaning has changed. We then have to escape these special characters when we try to use them as originally intended.

I don't think there is a perfect solution. A theme that I am constantly bringing up in tech conversations is that every solution requires tradeoffs. I definitely see the benefits of text based files. In certain environments, text based files are the most versatile, such as on a desktop computer. Files can be indexed. There's command line tools to batch manipulate text files. Some operating systems even do version control for changes to text files. But all of these features are not inherent to the text file itself, but come from systems that have built up around the format.

On the web, because JavaScript so easily can manipulate JSON-like objects, JSON is winning as a favorite file format. There are tools to store, index, and batch-manipulate JSON files in the same way text files are handled on desktop environments. Again, it is not because JSON is inherently better, but because tools are there to make it powerful.

The problem with standards, is that unless absolutely everyone agrees to use it, then you have to find a way to inter-op with people who don't conform to the standard. From experience, I can safely say there will never be a time when we all agree on a standard. Even for something as simple as CSS there are dozens of different ways to write it and then it all gets compiled to CSS in the end (I personally prefer SASS). The fact that they all compile to the standard makes it less of an issue. You can use what you already know and works for you.

> Every medium for ideas is corruptible. There’s no magic file format. Most are likely to last long enough for you to convert to something else if need be. It’s more important to find the constraint that works for you.
>
> —[CJ Chilvers](https://www.cjchilvers.com/blog/is-plain-text-best/)

I am currently working on an app for annotating documents. I have stalled because I am in a crisis about whether to save the annotations in an [atJSON](https://github.com/condenast/atjson) style offsets list or as [W3C JSON-LD Annotations](https://w3c.github.io/web-annotation/model/wd2/). I will probably need at some point to convert between the two, so the truth is, the format used to save it as is kind of trivial. You chose one format as the source of truth and convert to the other. From there, there are already existing tools to output JSON offsets as Markdown or HTML. (I am currently leaning towards W3C annotations, since they are more of a standard, but JSON offsets will be best for annotating content that is constantly changing.)

So if I am making an app, I may not put everything in a text file. But as long as I have a way for users to get their data out by export or automatic conversion to a common file format, then I believe I meet the criteria for longevity of data.
