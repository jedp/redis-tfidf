redis-tfidf
===========

The Term-Frequency/Inverse-Document-Frequency IR algorithm 
implemented using redis.

Indexing documents
------------------

Assume we have a collection of documents, each with its own
unique identifier.  We supply the identifier and the document
text to the collector:

    $ node
    > var collector = require("./collector");
    > collector.indexDocument(1, "I love cats; I love every kind of cat.");
    > collector.indexDocument(2, "Sorry, I'm thinking about cats again!");
    > collector.indexDocument(3, "Can't hug every cat.");

As documents are indexes, words are tokenized using a 
[Porter stemmer](https://github.com/jedp/porter-stemmer).

 
Searching for Documents
-----------------------

For a given query, document IDs for matching documents are returned in order of
relevance.

Note that there is no synchronous version of the search function.  You have to 
use a callback to do anything with search results.

    > collector.search("love", console.log);
    null [ 1 ]
    > collector.search("every", console.log);
    null [ 3, 1 ]
    > collector.search("cat", console.log);
    null [ 1, 2, 3 ]

As with indexing, query terms are stemmed.  So for example:

    > collector.search("hugging cats", console.log);
    null [ 3, 1, 2 ]

Document 3 is the best match for "hugging cats", since it contains "cat" and
"hug".  The other two documents are returned because they are about cats,
though they're short on hugging.

A Fuller Example
----------------

The `example/texts` directory contains poems downloaded from Project
Gutenberg.  The script `librarian.js` splits them up into poems, saves
them in a redis store (could be anything - the text storage has nothing
to do with the search mechanism itself), and indexes them.

The resulting 231 poems can be quickly searched:

    $ cd example
    $ node
    > var librarian = require("./librarian");
    > librarian.indexEverything();

    // wait for deferred calls to finish ...

    > librarian.search("flower");
    36 matches found
    1 ms elapsed
    Best match:
    32-Emily Dickinson-VII.


    VII.

    WITH A FLOWER.

    I hide myself within my flower,
    That wearing on your breast,
    You, unsuspecting, wear me too --
    And angels know the rest.

    I hide myself within my flower,
    That, fading from your vase,
    You, unsuspecting, feel for me
    Almost a loneliness.

Memory Use
----------

The memory use is not small.

The example texts contain 712kB. 

The resulting indexes in redis consume about 33MB.  

So the memory required for the redis indexes is about 50 times the space used
on disk to hold the original source text.


