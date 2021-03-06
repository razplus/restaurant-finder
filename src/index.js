/*
 * MIT License

 * Copyright (c) 2016 Garrett Vargas

 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:

 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.

 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

'use strict';

var AlexaSkill = require('./AlexaSkill');
var yelp = require('./Yelp');
var categoryList = require('./categories');
var storage = require('./storage');
var utils = require('./utils');

var APP_ID = "amzn1.ask.skill.4c848d38-347c-4e03-b908-42c6af6c207d";

var RestaurantFinder = function () {
    AlexaSkill.call(this, APP_ID);
};

// Extend AlexaSkill
RestaurantFinder.prototype = Object.create(AlexaSkill.prototype);
RestaurantFinder.prototype.constructor = RestaurantFinder;

RestaurantFinder.prototype.eventHandlers.onLaunch = function (launchRequest, session, response)
{
    var speechText = "Welcome to Restaurant Finder. You can find restaurants by type of cuisine, price range, or with high Yelp reviews. For example, you can say Find a cheap Chinese restaurant in Seattle. How can I help you?";
    
    // If the user either does not reply to the welcome message or says something that is not
    // understood, they will be prompted again with this text.
    var repromptText = "For instructions on what you can say, please say help me.";

    response.ask(speechText, repromptText);
};

RestaurantFinder.prototype.intentHandlers = {
    // Find Restaurant Intent
    "FindRestaurantIntent": function (intent, session, response) {
        // Build up our parameter structure from the intent
        var params = BuildYelpParameters(intent);
        var error;

        // First read in the last result in case we need to reference that instead
        storage.loadUserData(session, function(userData) {
            // If they didn't set a location in the request and we don't have one here, we
            // will prompt the user for their current location
            if (!params.location)
            {
                if (!userData.location)
                {
                    var speech = "As a new user, please specify your location by saying Set Location.";

                    SendAlexaResponse(null, speech, null, null, response);
                    return;
                }

                params.location = userData.location;
            }

            yelp.ReadRestaurantResults(params, function(speechError, speechResponse, speechQuestion, repromptQuestion, restaurantList) {
                if (restaurantList)
                {
                    userData.lastAction = ((restaurantList.total > 0) && (restaurantList.total <= 5)) ? "ReadList,0" : "FindRestaurant";
                    userData.lastResponse = restaurantList;
                    userData.save();
                }

                SendAlexaResponse(speechError, speechResponse, speechQuestion, repromptQuestion, response);
            });
        });
    },
    // Location intent
    "SetLocationIntent" : function (intent, session, response) {
        // If they have a location, we can use it - it can either be a city or a 5-digit ZIP code
        var locationSlot = intent.slots.Location;
        var locationZIPSlot = intent.slots.LocationZIP;
        var location;

        if (locationSlot && locationSlot.value)
        {
            location = locationSlot.value;
        }
        else if (locationZIPSlot && locationZIPSlot.value)
        {
            // Has to be five digits
            if (locationZIPSlot.value.length != 5)
            {
                SendAlexaResponse("Please specify a city name or five-digit ZIP code as your preferred location", null, null, null, response);
                return;
            }
            location = locationZIPSlot.value;
        }
        else
        {
            SendAlexaResponse("Please specify a city name or five-digit ZIP code as your preferred location.", null, null, null, response);
            return;
        }

        // They are specifying a location - we will set this in the DB - make sure to preserve
        // any other entries associated with this user
        storage.loadUserData(session, function(userData) {
            userData.location = location;
            userData.lastAction = "SetLocation";
            userData.save((error) => {
                var speech = "Preferred location set to " + utils.ReadLocation(location) + ".";

                // If this isn't a ZIP code, suggest that they can set by ZIP code
                if (location.length != 5 || isNaN(parseInt(location)))
                {
                    speech += " If this is incorrect, you can also specify a five-digit ZIP code.";
                }

                SendAlexaResponse(null, speech, null, null, response);
            });
        })
    },
    // Read list
    "ReadListIntent" : function (intent, session, response) {
        // We have to have a list to read
        storage.loadUserData(session, function(userData) {
            // If the last action was to read Details, then we should re-read the list rather than going to the next chunk
            if (userData.lastAction.indexOf("Details") > -1)
            {
                userData.lastResponse.read -= ((userData.lastResponse.read % 5) ? (userData.lastResponse.read % 5) : 5);
            }

            if (userData.lastResponse.read >= userData.lastResponse.restaurants.length) {
                var speech = "You are at the end of the list. Please ask for a new set of restaurants.";

                SendAlexaResponse(null, speech, null, null, response);
            }
            else
            {
                // OK, let's read - store the starting location first since reading the list will change it
                userData.lastAction = "ReadList," + userData.lastResponse.read;
                yelp.ReadRestaurantsFromList(userData.lastResponse, function(speech, reprompt) {
                    // Awesome - now that we've read, we need to write this back out to the DB
                    // in case there are more results to read
                    userData.save((error) => {
                        SendAlexaResponse(null, null, speech, reprompt, response);
                    });
                });
            }
        });
    },
    // Back
    "BackIntent" : function (intent, session, response) {
        storage.loadUserData(session, function(userData) {
            // If the last action was read list, go to the previous chunk of 5
            if (userData.lastAction.indexOf("ReadList") > -1)
            {
                userData.lastResponse.read -= ((userData.lastResponse.read % 5) ? (userData.lastResponse.read % 5) : 5);
                userData.lastResponse.read -= 5;
                if (userData.lastResponse.read < 0)
                {
                    // If they were at the start of the list, just repeat it
                    userData.lastResponse.read = 0;
                }
            }
            // If the last action was details, read the list again
            else if (userData.lastAction.indexOf("Details") > -1)
            {
                userData.lastResponse.read -= ((userData.lastResponse.read % 5) ? (userData.lastResponse.read % 5) : 5);
            }
            else
            {
                SendAlexaResponse(null, "I can't go back from this point. Please ask for a new set of restaurants.", null, null, response);
                return;
            }

            // OK, let's read - store the starting location first since reading the list will change it
            userData.lastAction = "ReadList," + userData.lastResponse.read;
            yelp.ReadRestaurantsFromList(userData.lastResponse, function(speech, reprompt) {
                // Awesome - now that we've read, we need to write this back out to the DB
                // in case there are more results to read
                userData.save((error) => {
                    SendAlexaResponse(null, null, speech, reprompt, response);
                });
            });
        });
    },
    // Details on a specific restaurant
    "DetailsIntent" : function (intent, session, response) {
        var idSlot = intent.slots.RestaurantID;

        if (!idSlot || !idSlot.value)
        {
            SendAlexaResponse("I'm sorry, I didn't hear a number of the restaurant you wanted details about.", null, null, null, response);
            return;
        }

        // They need to have a list to read details from
        storage.loadUserData(session, function(userData) {
            // OK, let's get the details
            yelp.ReadResturantDetails(userData.lastResponse, idSlot.value, function(error, speechResponse, speechReprompt, reprompt, readDetails) {
                // If the user successfully read the list, then the last action has changed, otherwise keep the last action as it was
                if (readDetails)
                {
                    userData.lastAction = "Details," + idSlot.value;
                    userData.save();
                }
                SendAlexaResponse(error, speechResponse, speechReprompt, reprompt, response);
            });
        });
    },
    // Repeat intent - read the last thing we read
    "AMAZON.RepeatIntent": function (intent, session, response) {
        // Well, let's see what they did last so we can re-issue that command
        storage.loadUserData(session, function(userData) {
            // I can only repeat if they did a Details or a Read List
            var lastAction = userData.lastAction.split(",");

            if ((lastAction.length == 2) && (lastAction[0] == "ReadList"))
            {
                // Reset read so we re-read the last response
                userData.lastResponse.read = parseInt(lastAction[1]);
                yelp.ReadRestaurantsFromList(userData.lastResponse, function(speech, reprompt) {
                    SendAlexaResponse(null, null, speech, reprompt, response);
                });
            }
            else if ((lastAction.length == 2) && (lastAction[0] == "Details"))
            {
                yelp.ReadResturantDetails(userData.lastResponse, parseInt(lastAction[1]), function(error, speechResponse, speechReprompt, reprompt, saveState) {
                    SendAlexaResponse(error, speechResponse, speechReprompt, reprompt, response);
                });
            }
            else
            {
                SendAlexaResponse(null, "You can say repeat after you've read a list of restaurants or details on a specific restaurant.", null, null, response);
            }
        });
    },
    // Stop intent
    "AMAZON.StopIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    },
    // Cancel intent - for now we are session-less so does the same as goodbye
    "AMAZON.CancelIntent": function (intent, session, response) {
        var speechOutput = "Goodbye";
        response.tell(speechOutput);
    },
    // Help intent - provide help
    "AMAZON.HelpIntent": function (intent, session, response) {
        var speechText = "You can find restaurants by type of cuisine, price range, or Yelp review. For example, you can say Find a cheap Chinese restaurant in Seattle ... Now, what can I help you with?";
        var repromptText = "You can find restaurants by type of cuisine, price range, or Yelp review, or you can say exit... Now, what can I help you with?";
        var speechOutput = {
            speech: speechText,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };
        var repromptOutput = {
            speech: repromptText,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };
        response.ask(speechOutput, repromptOutput);
    }
};

/*
 * Sends a response to Alexa - you would expect one of speechError,
 * speechResponse, or speechQuestion to be set.  repromptQuestion
 * will be set if speechQuestion is set and will be a shorter form
 * of the speechQuestion (just asking what they want to do rather than
 * giving a full game status)
 */
function SendAlexaResponse(speechError, speechResponse, speechQuestion, repromptQuestion, response)
{
    var speechOutput;
    var repromptOutput;
    var cardTitle = "Restaurant Finder";

    if (speechError)
    {
        speechOutput = {
            speech: speechError,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };
        repromptOutput = {
            speech: "What else can I help with?",
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };
        response.ask(speechOutput, repromptOutput);
    }
    else if (speechResponse) {
        speechOutput = {
            speech: speechResponse,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };
        response.tellWithCard(speechOutput, cardTitle, speechResponse);
    }
    else {
        speechOutput = {
            speech: speechQuestion,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };
        repromptOutput = {
            speech: repromptQuestion,
            type: AlexaSkill.speechOutputType.PLAIN_TEXT
        };
        response.askWithCard(speechOutput, repromptOutput, cardTitle, speechQuestion);
    }
}

/*
 * This function takes a potential category name and returns the
 * category name that should be passed to the Yelp API, or null
 * if no matching category can be found
 * It's assumed the input is in lowercase
 */
function FindCategoryInList(category)
{
    var i;
    var alias = null;

    for (i = 0; i < categoryList.length; i++)
    {
        if (category == categoryList[i].alias.toLowerCase()
            || (category == categoryList[i].title.toLowerCase()))
        {
            // This is it - use the alias
            alias = categoryList[i].alias;
            break;
        }
    }

    return alias;
}

/*
 * This function takes a value and attempts to fit it into structure
 * to send to Yelp as appropriate
 */
function AddYelpParameter(params, value)
{
    var category = FindCategoryInList(value);
    var mapping = {
        "open": {field: "open_now", value: true},
        "open now": {field: "open_now", value: true},
        "cheap": {field: "price", value: "1"},
        "moderate": {field: "price", value: "2"},
        "spendy": {field: "price", value: "3"},
        "splurge": {field: "price", value: "4"},
        "inexpensive": {field: "price", value: "1,2"},
        "expensive": {field: "price", value: "3,4"},
        "costly": {field: "price", value: "4"},
        "pricey": {field: "price", value: "3,4"},
        "good": {field: "rating", value: "3,5"},
        "great": {field: "rating", value: "4,5"},
        "bad": {field: "rating", value: "0,2.5"},
        "terrible": {field: "rating", value: "0,2"}
    };

    if (category)
    {
        // OK, this matches a category
        if (params.categories)
        {
            params.categories += ("," + category);
        }
        else
        {
            params.categories = category;
        }
    }
    else if (mapping[value])
    {
        params[mapping[value].field] = mapping[value].value;
    }
}

/*
 * This function takes the Alexa intents and builds up a potential
 * structure to pass into the Yelp API
 */
function BuildYelpParameters(intent)
{
    var params = {};

    // You can have up to three intent slots - first let's see if we have a category
    if (intent.slots.FirstDescriptor && intent.slots.FirstDescriptor.value)
    {
        AddYelpParameter(params, intent.slots.FirstDescriptor.value.toLowerCase());
    }
    if (intent.slots.SecondDescriptor && intent.slots.SecondDescriptor.value)
    {
        AddYelpParameter(params, intent.slots.SecondDescriptor.value.toLowerCase());
    }
    if (intent.slots.ThirdDescriptor && intent.slots.ThirdDescriptor.value)
    {
        AddYelpParameter(params, intent.slots.ThirdDescriptor.value.toLowerCase());
    }
    if (intent.slots.Location && intent.slots.Location.value)
    {
        params.location = intent.slots.Location.value;
    }
    else if (intent.slots.LocationZIP && intent.slots.LocationZIP.value && intent.slots.LocationZIP.value.length == 5)
    {
        params.location = intent.slots.LocationZIP.value;
    }

    return params;
}

exports.handler = function (event, context) 
{
    var finder = new RestaurantFinder();
    finder.execute(event, context);
};
