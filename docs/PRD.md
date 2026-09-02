# PRD for the CMSC Lighting Client

## Basics

I've been tasked with creating a lighting client that can interact with the Thorium application (sibling to this repo), and send DMX inputs to a controller located on the same computer as this. Thorium currently has a DMX configuration built in, but I want to update it for this application. 

## Interactions

I want to make sure that we can interact with thorium events (subscriptions), mqtt annoucements (or whatever they're called), and a UI that a user can customize and use to their liking. 

I also want the ability to test, configure events to dmx inputs, etc. 

## Note from my PM
Universes: We speak/listen to two specific universes (10 & 11) with the Mag, Cas, Pho on one and Ody, Gal, Fal on the other.  The way it is physically patched to the DMX gateways thorium is transmitting through the line and has no knowledge of who it is speaking to. Mosaic is happier if there's only 1-2 devices on a sACN universe it's working with.  Triggers go to the address ranges I mentioned previously.

When Mosaic outputs we are using universe 1 for Lobby, 2-5 for Magellan Cassini Phoenix and 6-8 for Odyssey Galileo Falcon. 

The "Camera" computer currently has a browser that lets us watch the cameras and another tab that is playing the sounds sent through thorium.  It then has a kiosk that is handling SFX key strokes and transmitting lighting changes the the Enttec USB Pro connection.  I might be finding an alternative to playing sounds through the browser because Dante behaves differently in windows than it did with Mac.  My goal will be to simplify as much as we can so the startup process is easier on staff and so is the troubleshooting.

Lighting triggers are coming from thoriums alert level changes primarily.  Other triggers are coming from macros, timeline items, and macro buttons.