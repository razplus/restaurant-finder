/*
 * Source file that connects to Yelp
 */

'use strict';

var config = require("./config");
const https = require('https');
const querystring = require('querystring');
var utils = require("./utils");

module.exports = {
    ReadRestaurantResults : function(params, callback) {
        // First get the list of restaurants
        GetRestaurantList(params, function(error, restaurantList) {
            // OK, let them know how many results were found, and give them an option to filter
            if (error)
            {
                callback(error, null, null, null, null);
            }
            else
            {
                var speech, reprompt;

                // If there are more than five results, prompt the user to filter further
                if (restaurantList.total > 5)
                {
                    speech = "I found " + ((restaurantList.total > 100) ? "more than 100" : restaurantList.total) + " " + ParamsToText(params) + ". ";
                    reprompt = "Repeat your request with additional conditions like good or cheap to narrow the list, or say Read List to start reading the list.";
                    speech += reprompt;
                    callback(null, null, speech, reprompt, restaurantList);
                }
                else if (restaurantList.total > 0)
                {
                    ReadList(restaurantList, function(speech, reprompt) {
                        callback(null, null, speech, reprompt, restaurantList);
                    });
                }
                else
                {
                    speech = "I'm sorry, I didn't find any " + ParamsToText(params);

                    callback(null, speech, null, null, restaurantList);
                }
            }
        });
    },
    ReadRestaurantsFromList : function(restaurantList, callback) {
        ReadList(restaurantList, callback);
    },
    ReadResturantDetails : function(restaurantList, indexToRead, callback) {
        // I have to have read some results first
        if (restaurantList.restaurants.length == 0)
        {
            callback(null, "Please ask for a set of restaurants before asking for details.", null, null);
        }
        else if (restaurantList.read == 0)
        {
            callback(null, "Please ask to start reading the list before asking for details.", null, null);
        }
        else
        {
            // Let's figure out where exactly we should be reading - read is what we've read up thru
            var toRead;

            toRead = (5 * Math.floor((restaurantList.read - 1) / 5));
            toRead += (indexToRead - 1);
            if (toRead >= restaurantList.restaurants.length)
            {
                var speechReprompt, reprompt;

                speechReprompt = indexToRead + " is not a valid option to read.";
                reprompt = "Please ask for a valid number or say repeat to repeat the list.";
                speechReprompt += (" " + reprompt);
                callback(null, null, speechReprompt, reprompt);
            }
            else
            {
                // OK, this should be good
                var restaurant = restaurantList.restaurants[toRead];
                var priceList = ["cheap", "moderately priced", "spendy", "splurge"];
                var speech;

                // Read information about the restaurant
                speech = restaurant.name + " is located at " + restaurant.location.address1 + " in " + restaurant.location.city;
                speech += (". It has a Yelp rating of " + restaurant.rating + " based on " + restaurant.review_count + " reviews.");
                if (restaurant.price)
                {
                    speech += (" It is a " + priceList[restaurant.price - 1] + " option.");
                }
                if (restaurant.phone)
                {
                    speech += (" The phone number is " + restaurant.phone);
                }

                callback(null, speech, null, null, true);
            }
        }
    }
};

function SendYelpRequest(path, callback)
{
    var headers = {"Authorization": "Bearer " + config.token};
    var options = { hostname: 'api.yelp.com', port: 443, path: path, method: "GET", headers: headers };

    var req = https.request(options, (res) => {
        if (res.statusCode == 200)
        {
            // Process the response
            var fulltext = '';
            res.on('data', (data) => {fulltext += data;});
            res.on('end', () => callback(null, JSON.parse(fulltext)));
        }
        else
        {
            // Sorry, there was an error calling the HTTP endpoint
            callback("Unable to call endpoint", null);
        }
    });

    req.end();
    req.on('error', (e) => { callback(e, null); });
}

/* Params has the following structure:
 *   location: string identifying the location (city or ZIP)
 *   categories: Categories which should be matched
 *   open_now: Boolean indicating if the location is open now
 *   radius: Either tight (1 mile) or wide (25 miles) If not set, default is 10 miles
 *
 *   See https://www.yelp.com/developers/documentation/v3/business_search
 *   for Yelp API documentation
 */
function GetRestaurantList(params, callback)
{
    var urlPath = "/v3/businesses/search?term=restaurants&limit=50&";

    // Actually rating is not a parameter, it's a filter - so strip that out of the URL query
    var yelpParams = {};
    for (var field in params) {if (field != "rating") {yelpParams[field] = params[field];}};

    // BUGBUG - Should we do some validation on params?
    urlPath += querystring.stringify(yelpParams);
    SendYelpRequest(urlPath, function(error, restaurantList) {
        if (error) {
            callback(error, null);
        }
        else {
            // Save fields we care about from Yelp, also note the total number
            // of restaurants and how many we've read to the user so far (0)
            var results = {total: restaurantList.total, read: 0, restaurants: []};
            var ratingFilter = [];
            if (params.rating)
            {
                ratingFilter = params.rating.split(",");
            }

            restaurantList.businesses.forEach(restaurant => {
                let myResult = {};

                // Convert the phone number to a US number
                if (restaurant.phone)
                {
                    if ((restaurant.phone.length == 12 && (restaurant.phone.indexOf("+1") > -1)))
                    {
                        // OK, make it (xxx) xxx-xxxx
                        myResult.phone = "(" + restaurant.phone.substring(2,5) + ") " + restaurant.phone.substring(5,8) + "-" + restaurant.phone.substring(8,12);
                    }
                    else
                    {
                        // Just use this
                        myResult.phone = restaurant.phone;
                    }
                }

                myResult.name = restaurant.name;
                myResult.location = restaurant.location;
                myResult.rating = restaurant.rating;
                myResult.review_count = restaurant.review_count;
                myResult.is_closed = restaurant.is_closed;
                myResult.price = (restaurant.price) ? Math.min(restaurant.price.length, 4) : 0;
                myResult.distance = restaurant.distance;
                myResult.url = restaurant.url;

                // If there is a rating filter, honor it
                if ((ratingFilter.length != 2) ||
                        ((myResult.rating >= ratingFilter[0]) && (myResult.rating <= ratingFilter[1])))
                {
                    results.restaurants.push(myResult);
                }
            });

            results.total = results.restaurants.length;
            callback(error, results);
        }
    });
}

function ReadList(restaurantList, callback)
{
    var speech, reprompt;
    var toRead = Math.min(restaurantList.restaurants.length - restaurantList.read, 5);

    // OK, read the names as allow them to ask for more detail on any choice
    speech = "Reading " + toRead + " restaurants. ";
    reprompt = "You can ask for more details by saying the corresponding restaurant number";
    reprompt += ((restaurantList.restaurants.length - restaurantList.read > 5) ? " or say More to hear more results. " : ". ");
    speech += reprompt;

    var i;
    for (i = 0; i < toRead; i++)
    {
        speech += (" " + (i + 1) + " ... " + restaurantList.restaurants[restaurantList.read + i].name + ".");
    }
    restaurantList.read += toRead;

    // Return the speech and reprompt text
    callback(speech, reprompt);
}

/*
 * Converts the parameters that were passed in into a text string
 */
function ParamsToText(params)
{
    var result = "";

    if (params.open_now)
    {
        result += "open ";
    }
    if (params.rating)
    {
        var ratingMap = {"3,5": "good", "4,5": "great", "0,2.5": "bad", "0,2": "terrible"};

        result += ratingMap[params.rating];
        result += " ";
    }
    if (params.price)
    {
        var priceMap = {"1": "cheap", "2": "moderate", "3": "spendy", "4": "splurge",
            "1,2": "inexpensive", "3,4": "expensive"};

        result += priceMap[params.price];
        result += " ";
    }
    if (params.categories)
    {
        var catList = params.categories.split(",");

        catList.forEach(cat => {result += (cat + " ");});
    }
    result += "restaurants";

    if (params.location)
    {
        result += " in " + utils.ReadLocation(params.location);
    }

    return result;
}
